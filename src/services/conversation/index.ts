import { APIGatewayEvent } from 'aws-lambda';
import log from 'lambda-log';
import { eventsJson } from 'common/middleware';
import util, { HTTPResponse } from 'common/util';
import qs from 'querystring';
import { maxBy } from 'lodash';
import { TranslationServiceClient } from '@google-cloud/translate';
import bigparser from '@a-n-u-b-i-s/bigparser';
import { Client } from '@googlemaps/google-maps-services-js';

const { RIDERS_GRID_ID, GOOGLE_MAPS_API_KEY } = process.env;
const APPROVED_LOCATION_TYPES = [
  'street_address',
  'intersection',
  'neighborhood',
  'premise',
  'subpremise',
  'natural_feature',
  'airport',
  'park',
  'point_of_interest',
];

const mapsClient = new Client({});
log.options.debug = process.env.ENVIRONMENT === 'development';

interface APIGatewayEventWithCookies extends APIGatewayEvent {
  cookies: string[];
}

type MessagingWebhookBody = {
  MessageSid: string;
  Body: string;
  From: string;
  To: string;
};

type SessionData = {
  lang?: string;
  messageID: string;
};

const detectLanguage = async (text: string) => {
  const translationClient = new TranslationServiceClient();
  // Construct request
  const request = {
    parent: 'projects/hoohacks-2022/locations/global',
    content: text,
  };

  // Run request
  const [response] = await translationClient.detectLanguage(request);

  log.debug(JSON.stringify(response.languages));

  const foundMax = maxBy(response.languages, 'confidence');
  if (foundMax.confidence > 0.8) {
    return foundMax;
  }
  return {
    confidence: 1,
    languageCode: 'en',
  };
};

const translateText = async (text: string, languageCode: string) => {
  if (languageCode === 'en') {
    return text;
  }

  const translationClient = new TranslationServiceClient();
  // Construct request
  const request = {
    parent: 'projects/hoohacks-2022/locations/global',
    contents: [text],
    sourceLanguageCode: 'en',
    targetLanguageCode: languageCode,
  };

  // Run request
  const [response] = await translationClient.translateText(request);

  log.debug(JSON.stringify(response.translations));

  return response.translations[0].translatedText;
};

const findNameInGrid = async (twilioData) => {
  const queryObject = {
    query: {
      sendRowIdsInResponse: true,
      showColumnNamesInResponse: true,
      columnFilter: {
        filters: [
          {
            column: 'Phone #',
            operator: 'EQ',
            keyword: twilioData.From,
          },
        ],
      },
    },
  };

  log.debug(JSON.stringify(queryObject));
  let gridResponse;
  try {
    gridResponse = await bigparser.search(queryObject, RIDERS_GRID_ID);
    log.debug(JSON.stringify(gridResponse));
    if (
      !gridResponse.data?.rows ||
      gridResponse.data.rows.length <= 0 ||
      !gridResponse.data.rows[0].Name
    ) {
      return '';
    }
    return gridResponse.data.rows[0].Name;
  } catch (error) {
    return '';
  }
};

const createNewSession = async (sessionData, twilioData, name) => {
  const insertObject = {
    insert: {
      rows: [
        {
          Language: sessionData.lang,
          'Phone #': twilioData.From,
          Name: name,
          Completed: 'false',
          Expired: 'false',
        },
      ],
    },
  };

  log.debug(JSON.stringify(insertObject));
  let gridResponse;
  try {
    gridResponse = await bigparser.insert(insertObject, RIDERS_GRID_ID);
    log.debug(gridResponse);
    if (
      !gridResponse?.data?.createdRows ||
      !gridResponse?.data?.createdRows['0']
    ) {
      return null;
    }
    return gridResponse?.data?.createdRows['0'];
  } catch (error) {
    return null;
  }
};

const routeInitial = async (sessionData, twilioData) => {
  const name = await findNameInGrid(twilioData);
  log.debug(name);
  if (!name) {
    const reply = await translateText(
      'Thank you for signing up for RoadShare. Help us get to know you! What is your first name?',
      sessionData.lang,
    );
    return { reply, updatedSession: { ...sessionData, messageId: 'name' } };
  }
  const sessionRowId = await createNewSession(sessionData, twilioData, name);
  log.debug(sessionRowId);
  if (!sessionRowId) {
    const reply = await translateText(
      'We are sorry, we are experiencing high volumes at this time. Please check back in 30 mins.',
      sessionData.lang,
    );
    return { reply, updatedSession: { ...sessionData, messageId: 'initial' } };
  }
  const reply = await translateText(
    `Welcome, ${name}! What is your pickup location?`,
    sessionData.lang,
  );
  return {
    reply,
    updatedSession: { ...sessionData, sessionRowId, messageId: 'pickup' },
  };
};

const parseName = (message: string) => {
  const name = message.replace(/my name is/gi, '');
  return name;
};

const routeName = async (sessionData, twilioData) => {
  const name = parseName(twilioData.Body);
  const sessionRowId = await createNewSession(sessionData, twilioData, name);
  log.debug(sessionRowId);
  const reply = await translateText(
    `Welcome, ${name}! What is your pickup location?`,
    sessionData.lang,
  );
  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'pickup', sessionRowId },
  };
};

const findSession = async (sessionData, twilioData) => {
  let queryObject;
  if (sessionData.sessionRowId) {
    queryObject = {
      query: {
        columnFilter: {
          filters: [
            {
              column: '_id',
              operator: 'EQ',
              keyword: sessionData.sessionRowId,
            },
          ],
        },
      },
    };
  } else {
    queryObject = {
      query: {
        sendRowIdsInResponse: true,
        showColumnNamesInResponse: true,
        columnFilter: {
          filters: [
            {
              column: 'Phone #',
              operator: 'EQ',
              keyword: twilioData.From,
            },
            {
              column: 'Completed',
              operator: 'EQ',
              keyword: 'false',
            },
            {
              column: 'Expired',
              operator: 'EQ',
              keyword: 'false',
            },
          ],
        },
      },
    };
  }
  log.debug(queryObject);
  let gridResponse;
  try {
    gridResponse = await bigparser.search(queryObject, RIDERS_GRID_ID);
    log.debug(gridResponse);
    if (
      !gridResponse.data?.rows ||
      gridResponse.data.rows.length <= 0 ||
      !gridResponse.data.rows[0]
    ) {
      return null;
    }
    return gridResponse.data.rows[0];
  } catch (error) {
    return null;
  }
};

const updateSession = async (gridSession, geocodedResult, Stage) => {
  let stageColumnUpdates: object;
  stageColumnUpdates[`${Stage} Location`] = geocodedResult.formattedAddress;
  stageColumnUpdates[`${Stage} GeoData`] = JSON.stringify(geocodedResult);
  const updateObject = {
    update: {
      rows: [
        {
          rowId: gridSession._id,
          columns: stageColumnUpdates,
        },
      ],
    },
  };
  log.debug(JSON.stringify(updateObject));
  try {
    await bigparser.update(updateObject, RIDERS_GRID_ID);
    log.debug('Updated');
  } catch (error) {
    return null;
  }
  return null;
};

const getGeocodedLocation = async (twilioData) => {
  const mapsResponse = await mapsClient.geocode({
    params: { address: twilioData, key: GOOGLE_MAPS_API_KEY },
  });
  log.debug(JSON.stringify(mapsResponse));
  return mapsResponse;
};

const routePickup = async (sessionData, twilioData) => {
  const gridSession = await findSession(sessionData, twilioData);
  if (!gridSession) {
    const response = await routeInitial(sessionData, twilioData);
    return response;
  }
  const geocodedResult = (await getGeocodedLocation(twilioData)).data
    .results[0];

  log.debug(JSON.stringify(geocodedResult));

  const isNotValidAddress = geocodedResult.types.every((type) => {
    const isNotValidType = !APPROVED_LOCATION_TYPES.includes(type);
    return isNotValidType;
  });

  log.debug(`${isNotValidAddress}`);

  if (isNotValidAddress) {
    const reply = await translateText(
      'Sorry, we didn\'t catch that. Please try entering a valid street address, such as "853 W Main St Charlottesville, VA 22903"',
      gridSession.Language,
    );
    return {
      reply,
      updatedSession: { ...sessionData, messageId: 'pickup' },
    };
  }
  await updateSession(gridSession, geocodedResult, 'Pickup');
  const reply = await translateText(
    'Thank you for sending your pickup location. What is your destination?',
    gridSession.Language,
  );
  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'destination' },
  };
};

const markCompleted = async (gridSession) => {
  const updateObject = {
    update: {
      rows: [
        {
          rowId: gridSession._id,
          columns: {
            Completed: true,
          },
        },
      ],
    },
  };
  log.debug(JSON.stringify(updateObject));
  try {
    await bigparser.update(updateObject, RIDERS_GRID_ID);
    log.debug('Completed');
  } catch (error) {
    return null;
  }
  return null;
};

const routeDestination = async (sessionData, twilioData) => {
  const gridSession = await findSession(sessionData, twilioData);
  if (!gridSession) {
    const response = await routeInitial(sessionData, twilioData);
    return response;
  }
  const geocodedResult = (await getGeocodedLocation(twilioData)).data
    .results[0];

  const isNotValidAddress = geocodedResult.types.every((type) => {
    const isNotValidType = !APPROVED_LOCATION_TYPES.includes(type);
    return isNotValidType;
  });

  log.debug(`${isNotValidAddress}`);

  if (isNotValidAddress) {
    const reply = await translateText(
      'Sorry, we didn\'t catch that. Please try entering a valid street address, such as "853 W Main St Charlottesville, VA 22903"',
      gridSession.Language,
    );
    return {
      reply,
      updatedSession: { ...sessionData, messageId: 'destination' },
    };
  }
  await updateSession(gridSession, geocodedResult, 'Destination');
  const reply = await translateText(
    'Thanks for submitting your details. We are looking for a match, and will let you know within the next 10 minutes if there is someone can share the road with you!',
    gridSession.Language,
  );

  await markCompleted(gridSession);

  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'initial' },
  };
};

const routeMessage = async (sessionData, twilioData) => {
  let response: { reply: string; updatedSession: SessionData };
  switch (sessionData.messageId) {
    case 'initial':
      response = await routeInitial(sessionData, twilioData);
      break;
    case 'name':
      response = await routeName(sessionData, twilioData);
      break;
    case 'pickup':
      response = await routePickup(sessionData, twilioData);
      break;
    case 'destination':
      response = await routeDestination(sessionData, twilioData);
      break;
    default:
      response = await routeInitial(sessionData, twilioData);
      break;
  }
  return response;
};

const conversation = async (
  event: APIGatewayEventWithCookies,
): Promise<HTTPResponse> => {
  if (!event.body) {
    return util._500('Missing Form Encoded Body');
  }

  let twilioData: object;
  if (event.isBase64Encoded) {
    twilioData = qs.parse(Buffer.from(event.body, 'base64').toString('utf-8'));
  } else {
    twilioData = qs.parse(event.body);
  }

  let sessionData: SessionData;
  if (!event.cookies || event.cookies.length <= 0) {
    sessionData = { messageID: 'initial' };
  } else {
    const sessionDataString = event.cookies
      .find((cookie) => cookie.startsWith('session_data'))
      .slice(13);
    if (!sessionDataString) {
      sessionData = { messageID: 'initial' };
    } else {
      try {
        sessionData = JSON.parse(sessionDataString);
        sessionData.messageID += 1;
      } catch (error) {
        sessionData = { messageID: 'initial' };
      }
    }
  }

  log.debug(JSON.stringify(sessionData));
  log.debug(JSON.stringify(twilioData));

  const messageLanguage = (
    await detectLanguage((twilioData as MessagingWebhookBody).Body)
  ).languageCode;

  log.debug(messageLanguage);

  if (
    messageLanguage !== 'en' &&
    sessionData.messageID !== 'pickup' &&
    sessionData.messageID !== 'destination'
  ) {
    (twilioData as MessagingWebhookBody).Body = await translateText(
      (twilioData as MessagingWebhookBody).Body,
      'en',
    );
  }

  if (!sessionData.lang) {
    sessionData.lang = messageLanguage;
  }

  const { reply, updatedSession } = await routeMessage(sessionData, twilioData);

  log.debug(reply);
  log.debug(JSON.stringify(updatedSession));

  return util._200(reply, `session_data=${JSON.stringify(updatedSession)}`);
};

export async function main(input: APIGatewayEventWithCookies) {
  const runnable = await eventsJson(conversation);
  const response = await runnable(input);
  return response;
}
