var Log = require('log');
var log = new Log('info');
var rollbar = require('rollbar');
var express = require('express');
var app = express();
var request = require('request');
var crypto = require('crypto');
var service = require('./boxService.js');
var storage = require('./storage.js');
var rollbarKeys = require('./rollbar.json');
var AWS = require('aws-sdk');
var timeout = require('connect-timeout');

AWS.config.loadFromPath('./src/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();
var rollbarOpts = {
    environment: 'Media'
};

const CACHE_EXPIRY = 1; //hours

app.use(timeout(45000));
app.use(logOnTimedout);

app.use(function clientErrorHandler(err, req, res, next) {
    rollbar.reportMessageWithPayloadData('Error with request', {request: req, error: err});
    res.status(500).send({ error: 'Something failed!' });
});

function logOnTimedout(req, res, next){
    if (req.timedout) {
        rollbar.reportMessageWithPayloadData('Got time out on request', req.url);
        res.status(429).send({ error: 'Something failed!' });
    }

    next();
}

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    var assetId;
    var r;
    var p;

    var params = {
        TableName: 'media-cache',
        Key: {
            'path': req.url
        }
    };

    log.debug(req.url);
    log.debug(req.params);

    assetId = req.params[0] || '0';
    log.debug('Asset Id: ' + assetId);

    p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        if (data) {
            res.send(data);
            log.debug(data);
            if (!data.cached) {
                log.info('Cache Miss');
                docClient.put({TableName: 'media-cache', Item: {
                    path: req.url,
                    expires: Math.floor((new Date).getTime() / 1000) + CACHE_EXPIRY * 360000,
                    data: data
                }}, function (err) {
                    if (err) {
                        console.error('cache store failed: ' + err);
                        rollbar.reportMessageWithPayloadData('Error trying to cache asset', {error: err, request: req});
                    }
                });
            } else {
                log.info('Cache Hit');
            }

        } else {
            log.debug('Asset not found');
            res.status(data && data.status || 404).send();
        }
    }).catch(err => {
        rollbar.reportMessageWithPayloadData('Error when trying to serve asset', {error: err, request: req});
        res.status(500).send({ error: 'Something failed!' });
    });

    docClient.get(params, function (err, data) {
        if (err || !Object.keys(data).length) {
            log.debug('No cache data for', data);
            service.getAssetInfo(assetId, r);
        } else {
            if (data.Item.expires - Math.floor((new Date).getTime() / 1000) < 0 ) {
                log.debug('Cache expired for', data);
                service.getAssetInfo(assetId, r);
            } else {
                log.debug('Cache Hit', data);
                data.Item.data.cached = true;
                r(data.Item.data);
            }
        }
    });

});

// Serve the asset
app.get('/f/*', function (req, res) {
    'use strict';

    log.debug(req.url);
    log.debug(req.params);

    var assetId = req.params[0] || '0';
    log.debug('Asset Id: ' + assetId);

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then((data, err, err2) => {
        log.debug(data);
        log.debug(err);
        log.debug(err2);
        if (data && data.url) {
            request
                .get(data.url)
                .on('response', function (response) {
                    response.headers['cache-control'] = 'public, max-age=604800';
                    response.headers.etag = crypto.createHash('md5').update(data.url).digest('hex');
                    return response;
                }).pipe(res);
        } else {
            res.status(data && data.status || 404).send();
        }
    }).catch(err => {
        rollbar.reportMessageWithPayloadData('Error when trying to serve asset', {error: err, request: req});
        res.status(500).send({ error: 'Something failed!' });
    });

    service.getAsset(assetId, r);
});

// ping the service (used for health checks
app.get('/p', function (req, res) {
    'use strict';

    res.status(200).send('LGTM');
});

rollbar.init(rollbarKeys.token, rollbarOpts);
rollbar.handleUncaughtExceptions(rollbarKeys.token, rollbarOpts);
rollbar.handleUnhandledRejections(rollbarKeys.token, rollbarOpts);
app.use(rollbar.errorHandler(rollbarKeys.token, rollbarOpts));

app.listen(3000, function () {
    service.init(storage);
    log.debug('Example app listening on port 3000!');
});
