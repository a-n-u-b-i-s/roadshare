import { APIGatewayEvent } from 'aws-lambda';
import log from 'lambda-log';
import { eventsJson } from 'common/middleware';
import util, { HTTPResponse } from 'common/util';
import qs from 'querystring';

log.options.debug = process.env.ENVIRONMENT === 'development';

interface APIGatewayEventWithCookies extends APIGatewayEvent {
  cookies: string[];
}

const email = async (
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

  let sessionData: object;
  if (!event.cookies || event.cookies.length <= 0) {
    // return util._500('Missing Session Cookies');
    sessionData = { lang: 'en-us' };
  } else {
    const sessionDataString = event.cookies
      .find((cookie) => cookie.startsWith('session_data'))
      .slice(13);
    sessionData = JSON.parse(sessionDataString);
  }

  log.debug(JSON.stringify(twilioData));

  return util._200('Hi', `session_data=${JSON.stringify(sessionData)}`);
};

export async function main(input: APIGatewayEventWithCookies) {
  const runnable = await eventsJson(email);
  const response = await runnable(input);
  return response;
}
