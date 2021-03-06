"use strict";

var restify = require("restify");
var bunyan = require("bunyan");
var uuid = require("node-uuid");
var mongoose = require("mongoose");
var MongooseObjectStream = require("mongoose-object-stream");

var packageJson = require("../package.json");

var config = require("./config");
var models = require("./models");

var connection = mongoose.connect(config.DATABASE).connection;
var Models = models(connection);

var logStream = new MongooseObjectStream(Models.Log);

module.exports.logStream = logStream;

var log = bunyan.createLogger({
    name: packageJson.name,
    level: config.DEFAULT_LOG_LEVEL,
    stream: logStream
});

var server = restify.createServer({
    name: packageJson.name,
    version: packageJson.version,
    log: log
});

server.use(function(req, res, next) {
    req._requestStartTime = new Date();
    next();
});

// Some basic middleware that will either be needed, or be useful for any kind
// of moderate extending.
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser({rejectUnknown: true}));
server.use(restify.authorizationParser()); // If you're doing your own auth.
server.use(restify.CORS()); // eslint-disable-line new-cap

// Upgrade the request logger to include a unique request ID, and the url that
// is being used in so that they can be queried/debugged in the future.
server.use(function(req, res, next) {
    req.log = req.log.child({
        url: req.url,
        method: req.method,
        requestId: uuid.v4(),
        userAgent: req.headers["user-agent"] || "Unknown"
    });
    return next();
});

module.exports.server = server;

// Only start listening after db connection is open.
connection.once("open", function() {
    server.listen(config.PORT, function() {
        server.log.info("%s listening at %s", server.name, server.url);
        console.log("%s listening at %s", server.name, server.url);
        module.exports.serving = true;
        module.exports.database = connection;
    });
});

connection.on("error", function(err) {
    server.log.error(err);
});

// Different error logs of increasing severity.
server.on("after", function(req, res, route, err) {
    if ( err ) {
        req.log.warn(err);
    }

    var requestEndTime = new Date();
    var requestDuration = requestEndTime - req._requestStartTime;
    req.log.debug({
        duration: requestDuration,
        statusCode: res.statusCode
    });
});

server.on("uncaughtException", function(req, res, route, err) {
    req.log.error(err);
    // Mimic the regular restify uncaught exception handler.
    res.status(500);
    res.send({
        code: "InternalError",
        message: err.message
    });
});

// istanbul ignore next: Would actually require killing tests, I think.
process.on("uncaughtException", function(exc) {
    server.log.fatal(exc);
    throw exc;
});

// Routes
require("./routes")(server, connection);
