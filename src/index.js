var _ = require('lodash');
var Log = require('log');
var log = new Log('info');
var rollbar = require('rollbar');
var express = require('express');
var app = express();
var request = require('request');
var crypto = require('crypto');
var mime = require('mime-types');
var service = require('./intelligence_bank_service.js');
var IntelligenceBankConfig = require('../conf/intelligence_bank_config.json');
var rollbarKeys = require('../conf/rollbar.json');
var AWS = require('aws-sdk');
var timeout = require('connect-timeout');
var cliArgs = require('optimist').argv;

AWS.config.loadFromPath('./conf/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();
var rollbarOpts = {
    environment: 'Media'
};

const CACHE_EXPIRY = 1; //hours

app.use(timeout(45000));
app.use(logOnTimedout);

app.use(function clientErrorHandler(err, req, res, next) {
    rollbar.reportMessageWithPayloadData('Error with request', {request: req, error: err});
    if (res.status) {
        res.status(500).send({ error: 'Something failed!' });
    } else {
        next();
    }
});

function logOnTimedout(req, res, next){
    if (req.timedout) {
        rollbar.reportMessageWithPayloadData('Got time out on request', req.url);
        res.status(429).send({ error: 'Something failed!' });
    }

    next();
}

function applyCurrentEnvironment(data) {
    var item = _.cloneDeep(data);
    if (item.src) {
        item.src = IntelligenceBankConfig.host + item.src;
    }
    if (item.thumb) {
        item.thumb = IntelligenceBankConfig.host + item.thumb;
    }
    if (item.items) {
        item.items = _.map(item.items, asset => applyCurrentEnvironment(asset));
    }
    return item;
}

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    var assetId;
    var assetResolve;
    var assetReject;
    var assetPromise;

    var params = {
        TableName: 'media-cache',
        Key: {
            'path': IntelligenceBankConfig.host + req.url
        }
    };

    log.debug(req.url);
    log.debug(req.params);

    assetId = req.params[0] || '0';
    log.debug('Asset Id: ' + assetId);

    assetPromise = new Promise((resolve, reject) => {
        assetResolve = data => {
            resolve(data);
        };

        assetReject = data => {
            reject(data);
        };
    });

    assetPromise.then(data => {
        if (data) {
            res.send(applyCurrentEnvironment(data));
            log.debug(data);
            if (!data.cached) {
                log.info('Cache Miss');
                docClient.put({TableName: 'media-cache', Item: {
                    path: IntelligenceBankConfig.host + req.url,
                    expires: Math.floor((new Date).getTime() / 1000) + CACHE_EXPIRY * 360000,
                    data: data
                }}, function (err) {
                    if (err) {
                        log.error('cache store failed: ' + err);
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
        if (err || !Object.keys(data).length || cliArgs.n || cliArgs.nocache) {
            log.debug('No cache data for', data);
            service.getAssetInfo(assetId, assetResolve, assetReject);
        } else {
            if (data.Item.expires - Math.floor((new Date).getTime() / 1000) < 0 ) {
                log.debug('Cache expired for', data);
                service.getAssetInfo(assetId, assetResolve, assetReject);
            } else {
                log.debug('Cache Hit', data);
                data.Item.data.cached = true;
                assetResolve(data.Item.data);
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

    var query = '';
    if (~req.url.indexOf('?')) {
        query = '?' + req.url.split('?')[1];
    }

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
            res.contentType('image/png');
            console.log('making request ' + data.url + ' with cookie ' + data.tracking);
            request
                .get({
                    url: data.url,
                    headers: { Cookie: data.tracking }
                })
                .on('response', function (response) {
                    var extension;
                    var mimeType;
                    response.headers['cache-control'] = 'public, max-age=604800';
                    extension = response.headers['content-disposition'].split('.')[1].toLowerCase().replace('"', '');
                    mimeType = mime.lookup(extension);
                    if (!mimeType) {
                        mimeType = 'image/png';
                    }
                    response.headers['content-type'] = mimeType;
                    res.contentType(mimeType);
                    response.headers['content-disposition'] = 'inline;';
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

    service.getAsset(assetId + query, r);
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
    //service.init(storage);
    service.init();
    log.debug('Example app listening on port 3000!');
});
