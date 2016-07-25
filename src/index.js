var Log = require('log');
var log = new Log('info');
var rollbar = require('rollbar');
var express = require('express');
var app = express();
var request = require('request');
var service = require('./boxService.js');
var storage = require('./storage.js');
var rollbarKeys = require('./rollbar.json');

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
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

    p.then(data => {
        if (data) {
            res.send(data);
        } else {
            res.status(data.status || 404).send('Not Found');
        }
    });

    service.getAssetInfo(assetId, r);
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

    p.then(data => {
        if (data && data.url) {
            request(data.url).pipe(res);
        } else {
            res.status(data.status || 404).send('Not Found');
        }
    });

    service.getAsset(assetId, r);
});

rollbar.init({environment: 'Media'});
rollbar.handleUncaughtExceptions(rollbarKeys.token);
rollbar.handleUnhandledRejections(rollbarKeys.token);
app.use(rollbar.errorHandler(rollbarKeys.token));

app.listen(3000, function () {
    service.init(storage);
    log.debug('Example app listening on port 3000!');
});
