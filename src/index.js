var express = require('express');
var app = express();
var path = require('path');
var fs = require('fs');
var service = require('./jsonService.js');

// query the asset
app.get(/^\/a\/{0,1}(.+)?/i, function (req, res) {
    'use strict';
    console.log(req.url);
    console.log(req.params);

    var assetId = req.params[0];
    console.log('Asset Id: ' + assetId);

    if (assetId === undefined) {
        console.log('No Asset requested returning page');
        var page = req.query.page || 1;
        var perPage = req.query.per_page || 10;

        res.send(service.getPage('/f/', page, perPage));
        return;
    }

    var r;
    var p = new Promise(resolve => {
        r = data => {
            resolve(data);
        };
    });

    p.then(data => {
        res.send(data);
    });

    service.getAsset(assetId, r);
});

// Serve the asset
app.get('/f/*', function (req, res) {
    'use strict';
    var fileName = path.normalize(__dirname + '/../media' + decodeURI(req.url.substring(2)));
    fs.stat(fileName, function (err, stats) {
        if (stats && stats.isFile()) {
            res.sendFile(fileName);
            return;
        }

        if (err) {
            console.log(err);
        }

        res.status(404).send('Not Found');
    });
});

app.listen(3000, function () {
    console.log('Example app listening on port 3000!');
});
