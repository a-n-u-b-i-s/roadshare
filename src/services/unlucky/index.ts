import { EventBridgeEvent } from 'aws-lambda';
import log from 'lambda-log';
import { eventsJson } from 'common/middleware';

log.options.debug = process.env.ENVIRONMENT === 'development';

const unlucky = async (
  event: EventBridgeEvent<string, object>,
): Promise<void> => {
  log.debug(event.detail.toString());
};

export async function main(input: EventBridgeEvent<string, object>) {
  const runnable = await eventsJson(unlucky);
  const response = await runnable(input);
  return response;
}
