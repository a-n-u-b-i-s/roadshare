import { EventBridgeEvent } from 'aws-lambda';
import log from 'lambda-log';
import { eventsJson } from 'common/middleware';
import * as bigparser from 'common/bigparser';
import moment from 'moment';

const {
  RIDERS_GRID_ID,
  TWILIO_PHONE_NUMBER,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
} = process.env;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

log.options.debug = process.env.ENVIRONMENT === 'development';

const getAllSearching = async () => {
  const queryObject = {
    query: {
      sendRowIdsInResponse: true,
      showColumnNamesInResponse: true,
      columnFilter: {
        filters: [
          {
            column: 'Searching',
            operator: 'LIKE',
            keyword: 'true',
          },
          {
            column: 'Completed',
            operator: 'LIKE',
            keyword: 'false',
          },
          {
            column: 'Expired',
            operator: 'LIKE',
            keyword: 'false',
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
  try {
    gridResponse = await bigparser.search(queryObject, RIDERS_GRID_ID);
    log.debug(JSON.stringify(gridResponse.data));
    if (!gridResponse.data?.rows || gridResponse.data.rows.length <= 0) {
      return null;
    }
    return gridResponse.data.rows;
  } catch (error) {
    log.debug(error);
    return null;
  }
};

const updateExpiryAndSendMessage = async (row) => {
  await client.messages.create({
    body: "We're sorry, but we could not find a match for you to ride with. Please consider using us at a later time.",
    from: TWILIO_PHONE_NUMBER,
    to: row['Phone #'],
  });
  const updateObject = {
    update: {
      rows: [
        {
          rowId: row._id,
          columns: {
            Expired: 'true',
            Searching: 'false',
          },
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

const unlucky = async (
  event: EventBridgeEvent<string, object>,
): Promise<void> => {
  log.debug(JSON.stringify(event));

  const rows = await getAllSearching();

  if (!rows) {
    return;
  }

  const expiredRows = rows.filter((row) => {
    const tenMinAgo = moment().subtract(10, 'minutes');
    const isExpired = moment(row['Created Timestamp']).isBefore(tenMinAgo);
    return isExpired;
  });

  const allNotifications = expiredRows.map(async (row) => {
    const rowPromise = await updateExpiryAndSendMessage(row);
    return rowPromise;
  });
  await Promise.all(allNotifications);
};

export async function main(input: EventBridgeEvent<string, object>) {
  const runnable = await eventsJson(unlucky);
  const response = await runnable(input);
  return response;
}
