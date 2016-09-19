var Log = require('log');
var log = new Log('info');
var rollbar = require('rollbar');
var express = require('express');
var app = express();
var request = require('request');
var crypto = require('crypto');
var mime = require('mime-types');
//var service = require('./boxService.js');
//var storage = require('./box_storage.js');
var service = require('./intelligence_bank_service.js');
var IntelligenceBankConfig = require('../conf/intelligence_bank_config.json');
var rollbarKeys = require('../conf/rollbar.json');
var AWS = require('aws-sdk');

AWS.config.loadFromPath('./conf/aws.json');
var docClient = new AWS.DynamoDB.DocumentClient();

const CACHE_EXPIRY = 1; //hours

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    var assetId;
    var r;
    var p;

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

    p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        if (data) {
            res.send(data);
            if (!data.cached) {
                docClient.put({TableName: 'media-cache', Item: {
                    path: IntelligenceBankConfig.host + req.url,
                    expires: Math.floor((new Date).getTime() / 1000) + CACHE_EXPIRY * 360000,
                    data: data
                }}, function (err) {
                    if (err) {
                        log.error('cache store failed: ' + err);
                    }
                });
            }
        } else {
            res.status(data.status || 404).send('Not Found');
        }
    });

    docClient.get(params, function (err, data) {
        if (err || !Object.keys(data).length) {
            log.info('Getting asset from service');
            service.getAssetInfo(assetId, r);
        } else {
            if (data.Item.expires - Math.floor((new Date).getTime() / 1000) < 0 ) {
                log.info('Cache Expired. Getting asset from service');
                service.getAssetInfo(assetId, r);
            } else {
                log.info('Getting asset from cache');
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

    p.then(data => {
        if (data && data.url) {
            res.contentType('image/png');
            request
                .get({
                    url: data.url,
                    headers: { Cookie: '_aid=18ec5caaa73230298b5bc42aab395d50_cgfrj9dg4n3nbehbeal4r6sqo2;' }
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
                    response.headers['content-disposition'] = 'inline;';
                    response.headers.etag = crypto.createHash('md5').update(data.url).digest('hex');
                    return response;
                }).pipe(res);
        } else {
            res.status(data.status || 404).send('Not Found');
        }
    });

    service.getAsset(assetId + query, r);
});

// ping the service (used for health checks
app.get('/p', function (req, res) {
    'use strict';

    res.status(200).send('LGTM');
});

rollbar.init({environment: 'Media'});
rollbar.handleUncaughtExceptions(rollbarKeys.token);
rollbar.handleUnhandledRejections(rollbarKeys.token);
app.use(rollbar.errorHandler(rollbarKeys.token));

app.listen(3000, function () {
    //service.init(storage);
    service.init();
    log.debug('Example app listening on port 3000!');
});
