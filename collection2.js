Meteor.Collection2 = function(name, options) {
    var self = this, userTransform, existingCollection;

    if (!(self instanceof Meteor.Collection2)) {
        throw new Error('use "new" to construct a Meteor.Collection2');
    }

    options = options || {};

    //set up simpleSchema
    self._simpleSchema = new SimpleSchema(options.schema);
    if ("schema" in options) {
        delete options.schema;
    }
	
	// add hooks
	self._beforeInsert = options.beforeInsert;
	self._beforeUpdate = options.beforeUpdate;
	self._afterInsert = options.afterInsert;
	self._afterUpdate = options.afterUpdate;
	options = _.omit(options, 'beforeInsert', 'beforeUpdate', 'afterInsert', 'afterUpdate');

    //get the virtual fields
    self._virtualFields = options.virtualFields;
    if ("virtualFields" in options) {
        delete options.virtualFields;
    }
    
    //create or update the collection
    if (typeof name === "object" && (name instanceof Meteor.Collection || name instanceof Meteor.SmartCollection)) {
        existingCollection = name;
        //set up virtual fields
        if (self._virtualFields) {
            userTransform = existingCollection._transform;
            options.transform = function(doc) {
                //add all virtual fields to document whenever it's passed to a callback
                _.each(self._virtualFields, function(func, fieldName, list) {
                    doc[fieldName] = func(doc);
                });
                //support user-supplied transformation function as well
                return userTransform ? userTransform(doc) : doc;
            };
            existingCollection._transform = Deps._makeNonreactive(options.transform);
        }
        //update the collection
        self._name = existingCollection._name;
        self._collection = existingCollection;
    } else {
        //set up virtual fields
        if (self._virtualFields) {
            userTransform = options.transform;
            options.transform = function(doc) {
                //add all virtual fields to document whenever it's passed to a callback
                _.each(self._virtualFields, function(func, fieldName, list) {
                    doc[fieldName] = func(doc);
                });
                //support user-supplied transformation function as well
                return userTransform ? userTransform(doc) : doc;
            };
        }
        //create the collection
        self._name = name;
        self._collection = new Meteor.Collection(name, options);
    }
};

_.extend(Meteor.Collection2.prototype, {
    find: function(/* arguments */) {
        var self = this, collection = self._collection;
        return collection.find.apply(collection, arguments);
    },
    findOne: function(/* arguments */) {
        var self = this, collection = self._collection;
        return collection.findOne.apply(collection, arguments);
    },
    _insertOrUpdate: function(type, args) {
        var self = this,
                collection = self._collection,
                schema = self._simpleSchema,
                doc, callback, error;

        if (!args.length) {
            throw new Error(type + " requires an argument");
        }

        if (type === "insert") {
			if(typeof self._beforeInsert === "function" && args[0]) {
				var newArgs = self._beforeInsert(args[0],schema._schema);
				if(typeof newArgs === "object")
					args[0] = newArgs;
			}
            doc = args[0];
        } else if (type === "update") {
            //for updates, we handle validating $set and $unset; otherwise, just
            //pass through to the real collection
            if (args[1] && (args[1].$set)) {
				if(typeof self._beforeUpdate === "function" && args[1]) {
					var newArgs = self._beforeUpdate(args[1],schema._schema,args[0]);
					if(typeof newArgs === "object")
						args[1] = newArgs;
				}
                doc = args[1];
            } else {
                return collection.update.apply(collection, args);
            }
        } else {
            throw new Error("invalid type argument");
        }

        //figure out callback situation
        if (args.length && args[args.length - 1] instanceof Function) {
            callback = args[args.length - 1];
        }
        if (Meteor.isClient && !callback) {
            // Client can't block, so it can't report errors by exception,
            // only by callback. If they forget the callback, give them a
            // default one that logs the error, so they aren't totally
            // baffled if their writes don't work because their database is
            // down.
            callback = function(err) {
                if (err)
                    Meteor._debug(type + " failed: " + (err.reason || err.stack));
            };
        }
		
		//check if we can handle any schema directives (datenow)
		if(type == "insert") {
			_.each(schema._schema, function(val,key) {
				if(val.datenow && !doc[key])
					doc[key] = new Date();
			});
		}
		
        //clean up doc
        doc = schema.filter(doc);
        doc = schema.autoTypeConvert(doc);
        //validate doc
        schema.validate(doc);

        if (schema.valid()) {
            if (type === "insert") {
                args[0] = doc; //update to reflect whitelist and typeconvert changes
                var res = collection.insert.apply(collection, args);
				if(typeof self._afterInsert === "function") {
					self._afterInsert(res,doc);
				}
				return res;
            } else {
                args[1] = doc; //update to reflect whitelist and typeconvert changes
                var res = collection.update.apply(collection, args);
				if(typeof self._afterUpdate === "function") {
					self._afterUpdate(res,doc);
				}
				return res;
            }
        } else {
            error = new Error("Failed validation");
			error.invalid = schema.invalidKeys();
            if (callback) {
                callback(error);
                return null;
            }
            throw error;
        }
    },
    insert: function(/* arguments */) {
        var args = _.toArray(arguments);
        return this._insertOrUpdate("insert", args);
    },
    update: function(/* arguments */) {
        var args = _.toArray(arguments);
        return this._insertOrUpdate("update", args);
    },
    remove: function(/* arguments */) {
        var self = this, collection = self._collection;
        return collection.remove.apply(collection, arguments);
    },
    allow: function(/* arguments */) {
        var self = this, collection = self._collection;
        return collection.allow.apply(collection, arguments);
    },
    deny: function(/* arguments */) {
        var self = this, collection = self._collection;
        return collection.deny.apply(collection, arguments);
    },
    simpleSchema: function() {
        return this._simpleSchema;
    }
});