let Promise = require('bluebird');
let Winston = require('winston');
let OpenWeatherMap = Promise.promisifyAll(require('openweathermap'));
let Influx = Promise.promisifyAll(require('influx'));
let request = Promise.promisifyAll(require('request'));

let dbName = process.env.APP_DB_NAME || 'home';
let dbConnectionURL = (process.env.APP_DB_URL || 'http://localhost:8086/') + dbName;
let dbClient = Influx(dbConnectionURL);
let dbTags = process.env.APP_DB_TAGS ? JSON.parse(process.env.APP_DB_TAGS) : null;
let dbMesurment = process.env.APP_DB_MEASUREMENT || 'weather';
let timeout = process.env.APP_TIMEOUT || 60000;
let env = process.env.NODE_ENV || 'dev';
let dev = env == 'dev';

let apiKey = process.env.APP_OWP_APIKEY;
let cityId = process.env.APP_OWP_CITYID || 2643743; // London

OpenWeatherMap.defaults({
  appid: apiKey,
  units: 'metric',
  lang: 'en',
  mode: 'json',
  cnt: 1,
});

var logger = new Winston.Logger({
  transports: [
    new (Winston.transports.Console)({
      timestamp: () => '[' + new Date().toLocaleString('ru', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }) + ']',
      level: dev ? 'info' : 'error',
      label: 'weather-sniffer',
      name: 'console',
      formatter: (options) => options.timestamp() + ' ' +
        options.label + '.' + options.level.toUpperCase() + ': ' +
        (options.message !== undefined ? options.message : '') +
        (options.meta && Object.keys(options.meta).length ? '\n\t' +
        JSON.stringify(options.meta) : ''),
    }),
  ],
});

logger.info(`dbName: ${dbName}`);
logger.info(`dbConnectionURL: ${dbConnectionURL.replace(/\/\w+:.*?@/, '/*:*@')}`);
logger.info(`dbTags: ${JSON.stringify(dbTags)}`);
logger.info(`env: ${env}`);
logger.info(`dev: ${dev}`);
if (dev) {
  Promise.config({
    warnings: true,
    monitoring: true
  });
}

function init() {
  dbClient.getDatabaseNames(function(err, arrayDatabaseNames){
    if (err) {
      logger.error(err.message);
      throw err;
    }
    if (arrayDatabaseNames.indexOf(dbName) === -1) {
      client.createDatabase(dbName, function(err, result) {
        if (err) {
          logger.error(err.message);
          throw err;
        }
        logger.info(result);
        serve();
      } )
    } else {
      serve();
    }
  })
}

function serve()
{
  logTemperature({cityId, tags: dbTags});
  Promise.delay(timeout).then(serve);
}

function logTemperature({cityId, tags = null})
{
  OpenWeatherMap.nowAsync({
    id: cityId,
    // rnd: new Date().getTime(), // may be with rand it`s hit not in cache
  })
    .then(res => makePoint(res))
    .then(point => dbClient.writePointAsync(dbMesurment, point, tags))
    .catch(err => logger.error(err));
}

function makePoint(data)
{
  if (!data || data.cod != 200) {
    throw new Error(`Bad response ${data.cod}: ${data.message}`);
  }
  if (!data.main) {
    throw new Erro(`Not found 'main' property in response`)
  }

  let point = {
    time: new Date(data.dt * 1000),
    temperature: data.main.temp,
    pressure: data.main.pressure,
    humidity: data.main.humidity,
  };
  if (data.wind) {
    Object.assign(point, {
      wind_speed: data.wind.speed,
    });
    if (data.wind.deg) {
      Object.assign(point, {
        wind_deg: data.wind.deg,
      });
    }
  }
  if (data.clouds) {
    Object.assign(point, {
      clouds: data.clouds.all,
    });
  }
  logger.info(point);

  return point;
}

init();
