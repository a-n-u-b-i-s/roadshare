const response = (statusCode: number) => {
  const curriedFunction = (body: string, cookie?: string): HTTPResponse => {
    const responseBody = {
      statusCode,
      body,
      headers: { 'Set-Cookie': cookie },
    };
    return responseBody;
  };
  return curriedFunction;
};

const util = {
  _100: response(100),
  _101: response(101),
  _103: response(103),
  _200: response(200),
  _201: response(201),
  _202: response(202),
  _203: response(203),
  _204: response(204),
  _205: response(205),
  _206: response(206),
  _300: response(300),
  _301: response(301),
  _302: response(302),
  _303: response(303),
  _304: response(304),
  _307: response(307),
  _308: response(308),
  _400: response(400),
  _401: response(401),
  _402: response(402),
  _403: response(403),
  _404: response(404),
  _405: response(405),
  _406: response(406),
  _407: response(407),
  _408: response(408),
  _409: response(409),
  _410: response(410),
  _411: response(411),
  _412: response(412),
  _413: response(413),
  _414: response(414),
  _415: response(415),
  _416: response(416),
  _417: response(417),
  _418: response(418),
  _422: response(422),
  _425: response(425),
  _426: response(426),
  _428: response(428),
  _429: response(429),
  _431: response(431),
  _451: response(451),
  _500: response(500),
  _501: response(501),
  _502: response(502),
  _503: response(503),
  _504: response(504),
  _505: response(505),
  _506: response(506),
  _507: response(507),
  _508: response(508),
  _510: response(510),
  _511: response(511),
};

export default util;

export interface HTTPResponse {
  statusCode: number;
  body: string;
  headers?: { 'Set-Cookie': string };
}
