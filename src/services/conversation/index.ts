import { APIGatewayEvent } from 'aws-lambda';
import log from 'lambda-log';
import { eventsJson } from 'common/middleware';
import util, { HTTPResponse } from 'common/util';
import qs from 'querystring';
import { maxBy, minBy } from 'lodash';
import { TranslationServiceClient } from '@google-cloud/translate';
import * as bigparser from 'common/bigparser';
import {
  Client,
  LatLng,
  TravelMode,
} from '@googlemaps/google-maps-services-js';
import Filter from 'bad-words';

const {
  RIDERS_GRID_ID,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_DISTANCE_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;
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
const wordFilter = new Filter();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

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
  messageId: string;
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
    log.debug(JSON.stringify(gridResponse.data));
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
          Searching: 'false',
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
    log.debug(gridResponse.data);
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
    wordFilter.clean(`Welcome, ${name}! What is your pickup location?`),
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
    wordFilter.clean(`Welcome, ${name}! What is your pickup location?`),
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
        sendRowIdsInResponse: true,
        showColumnNamesInResponse: true,
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
    log.debug(gridResponse.data);
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

  const postalCode = geocodedResult.address_components.find((comp) => {
    const isPostalCode = comp.types.includes('postal_code');
    return isPostalCode;
  });

  const state = geocodedResult.address_components.find((comp) => {
    const isState = comp.types.includes('administrative_area_level_1');
    return isState;
  });

  switch (Stage) {
    case 'Pickup':
      stageColumnUpdates = {
        'Pickup Location': geocodedResult.formatted_address,
        'Pickup GeoData': JSON.stringify(geocodedResult),
        'Pickup Zip': postalCode.short_name,
        'Pickup State': state.short_name,
      };
      break;
    case 'Destination':
      stageColumnUpdates = {
        'Destination Location': geocodedResult.formatted_address,
        'Destination GeoData': JSON.stringify(geocodedResult),
        'Destination Zip': postalCode.short_name,
        'Destination State': state.short_name,
        Searching: 'true',
        'Created Timestamp': new Date().toISOString(),
      };
      break;
    default:
      stageColumnUpdates = {
        'Pickup Location': geocodedResult.formatted_address,
        'Pickup GeoData': JSON.stringify(geocodedResult),
        'Pickup Zip': postalCode.short_name,
        'Pickup State': state.short_name,
      };
      break;
  }

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
    params: { address: twilioData.Body, key: GOOGLE_MAPS_API_KEY },
  });
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

  const isNotValidAddress =
    !geocodedResult ||
    !geocodedResult.types ||
    geocodedResult.types.every((type) => {
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
  try {
    await updateSession(gridSession, geocodedResult, 'Pickup');
  } catch (error) {
    const reply = await translateText(
      'Sorry, we didn\'t catch that. Please try entering a valid street address, such as "853 W Main St Charlottesville, VA 22903"',
      gridSession.Language,
    );
    return {
      reply,
      updatedSession: { ...sessionData, messageId: 'pickup' },
    };
  }
  const reply = await translateText(
    'Thank you for sending your pickup location. What is your destination?',
    gridSession.Language,
  );
  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'destination' },
  };
};

const markCompleted = async (gridSession, foundNearby) => {
  const updateObject = {
    update: {
      rows: [
        {
          rowId: gridSession._id,
          columns: {
            Searching: 'false',
            Completed: 'true',
          },
        },
        {
          rowId: foundNearby._id,
          columns: {
            Searching: 'false',
            Completed: 'true',
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

const calculateWalkingDistance = async (
  gridRow,
  gridSession,
  geocodedResult,
) => {
  const rowGeocodedPickupResult = JSON.parse(gridRow['Pickup GeoData']);
  const gridSessionPickupGeoData = JSON.parse(gridSession['Pickup GeoData']);

  log.debug(rowGeocodedPickupResult);
  log.debug(gridSessionPickupGeoData);

  const rowGeocodedDestinationResult = JSON.parse(
    gridRow['Destination GeoData'],
  );

  log.debug(rowGeocodedDestinationResult);
  log.debug(geocodedResult.geometry.location);

  const distanceAPIResponse = await mapsClient.distancematrix({
    params: {
      origins: [rowGeocodedPickupResult.geometry.location as LatLng],
      destinations: [gridSessionPickupGeoData.geometry.location as LatLng],
      mode: TravelMode.walking,
      key: GOOGLE_DISTANCE_API_KEY,
    },
  });

  log.debug(JSON.stringify(distanceAPIResponse.data));

  if (
    distanceAPIResponse?.data?.rows &&
    distanceAPIResponse?.data?.rows.length > 0 &&
    distanceAPIResponse?.data?.rows[0].elements &&
    distanceAPIResponse?.data?.rows[0].elements.length > 0 &&
    distanceAPIResponse?.data?.rows[0].elements[0].duration
  ) {
    const distanceAPIResponse2 = await mapsClient.distancematrix({
      params: {
        origins: [rowGeocodedDestinationResult.geometry.location as LatLng],
        destinations: [geocodedResult.geometry.location as LatLng],
        mode: TravelMode.walking,
        key: GOOGLE_DISTANCE_API_KEY,
      },
    });
    log.debug(JSON.stringify(distanceAPIResponse2.data));
    if (
      distanceAPIResponse2?.data?.rows &&
      distanceAPIResponse2?.data?.rows.length > 0 &&
      distanceAPIResponse2?.data?.rows[0].elements &&
      distanceAPIResponse2?.data?.rows[0].elements.length > 0 &&
      distanceAPIResponse2?.data?.rows[0].elements[0].duration
    ) {
      return {
        row: gridRow,
        distance:
          distanceAPIResponse.data.rows[0].elements[0].duration.value / 60 +
          distanceAPIResponse2.data.rows[0].elements[0].duration.value / 60,
      };
    }
    return {
      row: gridRow,
      distance:
        distanceAPIResponse.data.rows[0].elements[0].duration.value / 60 +
        555555,
    };
  }

  return {
    row: gridRow,
    distance: 1000000,
  };
};

const findNearby = async (gridSession, geocodedResult) => {
  const postalCode = geocodedResult.address_components.find((comp) => {
    const isPostalCode = comp.types.includes('postal_code');
    return isPostalCode;
  });

  const queryObject = {
    query: {
      sendRowIdsInResponse: true,
      showColumnNamesInResponse: true,
      columnFilter: {
        filters: [
          {
            column: '_id',
            operator: 'NEQ',
            keyword: gridSession._id,
          },
          {
            column: 'Pickup Zip',
            operator: 'EQ',
            keyword: gridSession['Pickup Zip'],
          },
          {
            column: 'Destination Zip',
            operator: 'EQ',
            keyword: postalCode.short_name,
          },
          {
            column: 'Searching',
            operator: 'EQ',
            keyword: 'true',
          },
        ],
      },
      pagination: {
        startRow: 1,
        rowCount: 999,
      },
    },
  };

  log.debug(JSON.stringify(queryObject));

  let gridResponse;
  let allRows;
  try {
    gridResponse = await bigparser.search(queryObject, RIDERS_GRID_ID);
    log.debug(JSON.stringify(gridResponse.data));
    if (!gridResponse.data?.rows || gridResponse.data.rows.length <= 0) {
      return null;
    }
    allRows = gridResponse.data.rows;
    if (!allRows || allRows.length <= 0) {
      return null;
    }
    log.debug(allRows);
  } catch (error) {
    return null;
  }

  const findDistances = allRows.map(async (row) => {
    log.debug(row);
    const obj = await calculateWalkingDistance(
      row,
      gridSession,
      geocodedResult,
    );
    return obj;
  });

  const distances = await Promise.all(findDistances);
  log.debug(JSON.stringify(distances));

  const nearbyRows = distances.filter(({ distance }) => distance < 10);
  log.debug(JSON.stringify(nearbyRows));

  const closestRow = minBy(nearbyRows, 'distance');
  log.debug(JSON.stringify(closestRow));

  if (!closestRow || !closestRow.row) {
    return null;
  }

  return closestRow.row;
};

const routeDestination = async (sessionData, twilioData) => {
  const gridSession = await findSession(sessionData, twilioData);
  if (!gridSession) {
    const response = await routeInitial(sessionData, twilioData);
    return response;
  }
  const geocodedResult = (await getGeocodedLocation(twilioData)).data
    .results[0];

  const isNotValidAddress =
    !geocodedResult ||
    !geocodedResult.types ||
    geocodedResult.types.every((type) => {
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

  try {
    await updateSession(gridSession, geocodedResult, 'Destination');
  } catch (error) {
    const reply = await translateText(
      'Sorry, we didn\'t catch that. Please try entering a valid street address, such as "853 W Main St Charlottesville, VA 22903"',
      gridSession.Language,
    );
    return {
      reply,
      updatedSession: { ...sessionData, messageId: 'destination' },
    };
  }

  const foundNearby = await findNearby(gridSession, geocodedResult);

  log.debug(foundNearby);

  if (!foundNearby) {
    const reply = await translateText(
      'Thanks for submitting your details. We are looking for a match, and will let you know within the next 10 minutes if there is someone who can share the road with you!',
      gridSession.Language,
    );
    return {
      reply,
      updatedSession: { ...sessionData, messageId: 'searching' },
    };
  }

  await markCompleted(gridSession, foundNearby);

  const finderMessage = await translateText(
    wordFilter.clean(
      `We found a match! ${gridSession.Name} will meet you at ${foundNearby['Pickup Location']} within the next 5 minutes. Happy riding!`,
    ),
    foundNearby.Language,
  );

  await twilioClient.messages.create({
    body: finderMessage,
    from: TWILIO_PHONE_NUMBER,
    to: foundNearby['Phone #'],
  });

  const reply = await translateText(
    wordFilter.clean(
      `We found a match! You will meet ${foundNearby.Name} at ${foundNearby['Pickup Location']} within the next 5 minutes. Happy riding!`,
    ),
    gridSession.Language,
  );

  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'initial', lang: null },
  };
};

const routeSearching = async (sessionData, twilioData) => {
  const gridSession = await findSession(sessionData, twilioData);
  if (
    !gridSession ||
    gridSession.Completed === 'true' ||
    gridSession.Searching === 'false' ||
    gridSession.Expired === 'true'
  ) {
    const response = await routeInitial(sessionData, twilioData);
    return response;
  }
  const reply = await translateText(
    'Just a moment — we are finding you a potential match! Hang tight.',
    gridSession.Language,
  );

  return {
    reply,
    updatedSession: { ...sessionData, messageId: 'searching' },
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
    case 'searching':
      response = await routeSearching(sessionData, twilioData);
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
    sessionData = { messageId: 'initial' };
  } else {
    const sessionDataString = event.cookies
      .find((cookie) => cookie.startsWith('session_data'))
      .slice(13);
    if (!sessionDataString) {
      sessionData = { messageId: 'initial' };
    } else {
      try {
        sessionData = JSON.parse(
          sessionDataString.replace(/\\\\/g, '\\').replace(/\\"/g, '"'),
        );
      } catch (error) {
        sessionData = { messageId: 'initial' };
      }
    }
  }

  log.debug(JSON.stringify(sessionData));
  log.debug(JSON.stringify(twilioData));

  if ((twilioData as MessagingWebhookBody).Body === 'RESET') {
    return util._200(
      'DONE',
      `session_data=${JSON.stringify({ messageId: 'initial' })};Max-Age=0`,
    );
  }

  const messageLanguage = (
    await detectLanguage((twilioData as MessagingWebhookBody).Body)
  ).languageCode;

  log.debug(messageLanguage);

  if (
    messageLanguage !== 'en' &&
    sessionData.messageId !== 'pickup' &&
    sessionData.messageId !== 'destination'
  ) {
    (twilioData as MessagingWebhookBody).Body = await translateText(
      (twilioData as MessagingWebhookBody).Body,
      'en',
    );
  }

  if (!sessionData.lang || sessionData.messageId === 'initial') {
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
