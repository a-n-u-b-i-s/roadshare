import log from 'lambda-log';

log.options.debug = process.env.ENVIRONMENT === 'development';

export const runFunction = async (
  handler: (event: object) => Promise<object | void>,
  input: object,
): Promise<object | void> => {
  log.debug('Function Input', input);
  const response = await handler(input);
  return response;
};

export const eventsJson = async (
  handler: (event: object) => Promise<object | void>,
) => {
  const wrappedFunction = async (input: object) => {
    const response = await runFunction(handler, input);
    return response;
  };
  return wrappedFunction;
};
