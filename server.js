// server.js - NodeJS server for the PiThermServer project.

/* 

Parses data from DS18B20 temperature sensor and serves as a JSON object.
Uses node-static module to serve a plot of current temperature (uses highcharts).

Tom Holderness 03/01/2013
Ref: www.cl.cam.ac.uk/freshers/raspberrypi/tutorials/temperature/
*/

// Load node modules
var fs = require('fs');
var sys = require('sys');
var async = require('async');
var http = require('http');
var sqlite3 = require('sqlite3');

// Use node-static module to server chart for client-side dynamic graph
var nodestatic = require('node-static');

// Setup static server for current directory
var staticServer = new nodestatic.Server(".");

// Setup database connection for logging
var db = new sqlite3.Database('./piTemps.db');

// Write a single temperature record in JSON format to database table.
function insertTemps(data) {
    var temps = data.temperature_records;
    var topTemp = findTemp(temps, "top");
	var bottomTemp = findTemp(temps, "bottom");
	var inTemp = findTemp(temps, "in");
	var outTemp = findTemp(temps, "out");

    // data is a javascript object   
    var statement = db.prepare("INSERT INTO temperature_records VALUES (?, ?, ?, ?, ?)");
    // Insert values into prepared statement
    statement.run(data.unix_time, topTemp, bottomTemp, inTemp, outTemp);
    // Execute the statement
    statement.finalize();
}

function findTemp(temps, sensor_name) {
	return temps.find(function(d) { return d.sensor === sensor_name; }).temp;
}

// Read current temperature from sensor
function readTemp(sensor, callback){
    fs.readFile('/sys/bus/w1/devices/' + sensor.value + '/w1_slave', function (err, buffer) {
        if (err) {
           callback(err);
           console.error(err);
           process.exit(1);
        }
        var data = buffer.toString('ascii').split(" ");
        var temp = parseFloat(data[data.length - 1].split("=")[1]) / 1000.0;
        temp = Math.round(temp*10) / 10;
        callback(null, { "sensor": sensor.key, "temp": temp} );
    });
}

// Read temperatures from sensors
function readTemps(callback) {
    var sensors = [];
    sensors.push({
        key: "top",
        value: "28-021581d6f1ff"
    });
    sensors.push({
        key:"bottom",
        value:"28-021581a9cdff"
    });
    sensors.push({
        key:"in",
        value:"28-0215819713ff"
    });
    sensors.push({
        key:"out",
        value:"28-0115818cf0ff"
    });

     async.map(sensors, readTemp, function (err, results){
         if(err){
             callback(err);
         }
         var data = {
            temperature_records: results,
            unix_time:Date.now()
         }
         callback(data);
     });
}

// Create a wrapper function which we'll use specifically for logging
function logTemp(interval) {
    // Call the readTemp function with the insertTemp function as output to get initial reading
    readTemps(insertTemps);
    // Set the repeat interval (milliseconds). Third argument is passed as callback function to first (i.e. readTemp(insertTemp)).
    setInterval(readTemp, interval, insertTemps);
};

// Get temperature records from database
function selectTemp(num_records, start_date, callback) {
    // - Num records is an SQL filter from latest record back trough time series, 
    // - start_date is the first date in the time-series required, 
    // - callback is the output function
    var current_temp = db.all("SELECT * FROM (SELECT * FROM temperature_records WHERE unix_time > (strftime('%s',?)*1000) ORDER BY unix_time DESC LIMIT ?) ORDER BY unix_time;", start_date, num_records,
       function (err, rows) {
           if (err) {
               //         response.writeHead(500, { "Content-type": "text/html" });
               //         response.end(err + "\n");
               console.log('Error serving querying database. ' + err);
               return;
           }
           else {
               data = { temperature_record: [rows] }
               callback(data);
           }
       });
};

// Setup node http server
var server = http.createServer(
// Our main server function
function (request, response) {
    // Grab the URL requested by the client and parse any query options
    var url = require('url').parse(request.url, true);
    var pathfile = url.pathname;
    var query = url.query;

    //Test to see if it's a database query
    if (pathfile == '/temperature_query.json') {
        //Test to see if number of observations was specified as url query
        if (query.num_obs) {
            var num_obs = parseInt(query.num_obs);
        }
        else {
            //If not specified default to 20. Note use -1 in query string to get all.
            var num_obs = -1;
        }
        if (query.start_date) {
            var start_date = query.start_date;
        }
        else {
            var start_date = '1970-01-01T00:00';
        }
        //Send a message to console log
        console.log('Database query request from ' + request.connection.remoteAddress + ' for ' + num_obs + ' records from ' + start_date + '.');
        // call selectTemp function to get data from database
        selectTemp(num_obs, start_date, function (data) {
            response.writeHead(200, { "Content-type": "application/json" });
            response.end(JSON.stringify(data), "ascii");
        });
        return;
    }

    //Test to see if it's a request for current temperature   
    if (pathfile == '/temperature_now.json') {
        readTemp(function (data) {
            response.writeHead(200, { "Content-type": "application/json" });
            response.end(JSON.stringify(data), "ascii");
        });
        return;
    }

    // Handler for favicon.ico requests
    if (pathfile == '/favicon.ico') {
        response.writeHead(200, { 'Content-Type': 'image/x-icon' });
        response.end();

        // Optionally log favicon requests.
        //console.log('favicon requested');
        return;
    }

    if (pathfile == '/index.html' || pathfile == '/' || pathfile == '/temperature_log.htm' || pathfile == '/temperature_plot.htm') {
        staticServer.serve(request, response, function (err, result) {
            if (err) {
                response.writeHead(err.status, err.headers);
                response.end('Error 404 - file not found');
                return;
            }
        });
    }


    else {
        console.log('refusing to serve a file that was not specificied!!!');
        response.statusCode = 404;
        response.end();
        return;
        /*
            // Print requested file to terminal
            console.log('Request from '+ request.connection.remoteAddress +' for: ' + pathfile);
        
            // Serve file using node-static      
            staticServer.serve(request, response, function (err, result) {
              if (err){
                // Log the error
                sys.error("Error serving " + request.url + " - " + err.message);
                  
                // Respond to the client
                response.writeHead(err.status, err.headers);
                response.end('Error 404 - file not found');
                return;
              }
            return;  
            })
        */
    }
});

// Start temperature logging (every 5 min).
var msecs = (60 * 5) * 1000; // log interval duration in milliseconds
logTemp(msecs);
// Send a message to console
console.log('Server is logging to database at ' + msecs + 'ms intervals');
// Enable server
server.listen(9000);
// Log message
console.log('Server running at http://localhost:9000');
