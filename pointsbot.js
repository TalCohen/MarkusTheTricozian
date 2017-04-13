var debug = process.env.debug || false;
if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('botkit');
var os = require('os');

var controller = Botkit.slackbot({
    json_file_store: 'botstorage-prod',
    stale_connection_timeout: 15000,
    debug: debug,
    send_via_rtm: false,
});

var bot = controller.spawn({
    token: process.env.token
});

bot.startRTM();

function add_reaction(bot, message, name) {
    name = name || 'robot_face';

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: name,
    }, function (err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji to message ' + message, err);
        }
    });
}

function check_ratelimit(bot, message, ratelimit_type, callback) {
    var user = message.user;

    console.log("checking ratelimit for " + ratelimit_type + " for user " + user);
    controllers.storage.users.get(user, function(err, user_data) {
        if (!err && user_data) {
            var last_message = user_data.ratelimit[ratelimit_type];
            if (last_message && last_message + 500 < message.ts) {
                // too soon
                console.log("too soon, returning");
                return;
            }
        }

        if (!user_data) {
            user_data = {
                ratelimit: {}
            };
        }

        user_data.ratelimit[ratelimit_type] = message.ts;

        console.log("saving user data " + user_data);
        controllers.storage.users.save({id: user, ratelimit:user_data.ratelimit});

        console.log("calling callback");
        callback();
    });
}

function generate_point_type_lookup_key(message, point_type) {
    return message.team + "-points-" + point_type;
}

function get_points(bot, message, point_type, callback) {
    var points = controller.storage.teams.get(generate_point_type_lookup_key(message, point_type), function(err, team_data) {
        if (err || !team_data) {
            team_data = {
                points: {}
            };
        }

        callback(team_data.points || {});
    });
}

function get_points_for(bot, message, point_type, id, callback) {
    function inner_callback(points) {
        callback(points[id] || 0);
    }

    get_points(bot, message, point_type, inner_callback);
}

function save_points(bot, message, point_type, id, amt) {
    function callback(points) {
        points[id] = amt;

        controller.storage.teams.save({id: generate_point_type_lookup_key(message, point_type), points: points}, function(err) {
            if (err) {
                throw new Error(err);
            }
        });
    }

    get_points(bot, message, point_type, callback);
}

controller.hears(["abhi"], "ambient,mention,direct_mention,direct_message", function(bot, message) {
    bot.replyInThread(message, "abhi is great");
});

controller.hears(["hello", "hi"], 'direct_message,direct_mention,mention', function(bot, message) {
    add_reaction(bot, message);

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' +user.name + '!!');
        } else {
            bot.reply(message, 'Hello.');
        }
    });
});

controller.hears(["([-\+]?\d+) ([\w\s]{0,50}) to (.*)"], "ambient,mention,direct_mention", function(bot, message) {
    console.log("add points call");
    add_reaction(bot, message);

    var amount = parseInt(message.match[1]);
    var point_type = message.match[2];
    var id = message.match[3];

    if (amount > 20 || amount < -20) {
        bot.replyInThread(message, "point amount of out range -20 <= points <= 20");
        return;
    }

    check_ratelimit(bot, message, function() {
        console.log("passed ratelimit check");
        function callback(existing_points) {
            var points = existing_points + amount;

            save_points(bot, message, id, point_type, points);
            bot.replyInThread(message, id + " has " + points + " points");
        }

        get_points_for(bot, message, point_type, id, callback);
    });
});

controller.hears(["how many points does (.*) have"], "ambient,direct_message,direct_mention,mention", function(bot, message) {
    add_reaction(bot, message);

    var id = message.match[1];

    get_points_for(bot, message, id, "points", function(points) {
        bot.replyInThread(message, id + " has " + points + " points.");
    });
});