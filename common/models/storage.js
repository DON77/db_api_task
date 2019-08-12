'use strict';

const fs = require('fs');
const path = require('path');
const csvToJson = require('csvtojson');
const loopback = require('loopback');
const https = require('https');
const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

module.exports = function(Storage) {

  Storage.observe('before save', async function(ctx, next) {

    const app = Storage.app;

    const engineType = ctx.instance.DbEngine;

    try {

      const datasourceName = engineType + "_" + ctx.instance.DbName;

      logger.info("create datasource with name:", datasourceName);

      const datasourceStructure = {
        "name": datasourceName,
        "connector": engineType,
        "host": ctx.instance.DbIp,
        "port": ctx.instance.DbPort,
        "database": ctx.instance.DbName,
        "username": ctx.instance.DbUserName,
        "password": ctx.instance.DbPassword,
        "createDatabase": true
      };

      const datasource = app.dataSource(datasourceName, datasourceStructure);

      datasource.on('error', (err) => {
        return false;
      });

      // create model for each table from arrays of tables "ctx.instance.DbStructure"

      if (!Array.isArray(ctx.instance.DbStructure)) return false;

      ctx.instance.DbStructure.forEach((table) => {

        //create a model from JSON defination
        const model = loopback.createModel(table.name, table.structure);

        //attach model to a datasource and app
        app.model(model, { dataSource: datasourceName });

        datasource.autoupdate(table.name, function (err, result) {

          logger.info("structure created");

          // todo - error handling

          saveModelToFile(table.name, model);

          associateModelToDatasource(table.name, datasourceName)

        });
      });

      // create a system models: account, task etc

      createSystemModel(engineType, ctx.instance.DbPrefixTable, "account", datasourceName, datasource, app);
      createSystemModel(engineType, ctx.instance.DbPrefixTable, "task", datasourceName, datasource, app);

      saveDatasourceToFile(datasourceName, datasourceStructure);

    } catch(err) {
      // An error occurred
      next(err);
    }

    return;
  });

  Storage.getStorageModel = (storageId, tableName, cb) => {
    Storage.findById(storageId, (err, storage) => {

      if (err) return cb(err, null);
      if (!storage) return cb(null, null);

      const datasourceName = storage['DbEngine'] + "_" + storage['DbName'];
      const dataSource = Storage.app.datasources[datasourceName];

      if (!dataSource) return cb(`datasource '${datasourceName}' is not found`, null);

      if (tableName == "account" || tableName == "task") {
        tableName = storage["DbPrefixTable"] + "_" + tableName;
      }

      return cb(null, dataSource.models[tableName], storage["DbPrefixTable"]);
    });
  };

  // save datasource in datasources.json file
  const saveDatasourceToFile = (datasourceName, datasourceJson) => {
    const datasourcesFile = path.resolve(__dirname, "..", "..", "server", "datasources.json");
    let content = JSON.parse(fs.readFileSync(datasourcesFile));
    content[datasourceName] = datasourceJson;
    fs.writeFileSync(datasourcesFile, JSON.stringify(content, null, "\t"));
  }

  // create a system model like account or task
  const createSystemModel = (engineType, DbPrefixTable, modelName, datasourceName, datasource, app) => {
    const filePath = path.resolve(__dirname, "..", "..", "db_modules", engineType, modelName + ".json");
    const structure = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    modelName = DbPrefixTable + "_" + modelName;

    const model = loopback.createModel(modelName, structure);
    //attach model to a datasource and app
    app.model(model, { dataSource: datasourceName });

    datasource.autoupdate(modelName, function (err, result) {
      logger.info(modelName + " structure created");

      saveModelToFile(modelName, model);

      associateModelToDatasource(modelName, datasourceName);

    });
  }

  const saveModelToFile = (name, model) => {

    let modelJSON = {}
    modelJSON.name = name;
    modelJSON.base = 'PersistedModel';
    modelJSON.properties = model.definition.rawProperties;

    const modelPath = path.resolve(__dirname, "..", "..", "common", "models", name + ".json");

    fs.writeFileSync(modelPath, JSON.stringify(modelJSON));

  }

  const associateModelToDatasource = (modelName, datasourceName) => {

    const modelConfigPath = path.resolve(__dirname, "..", "..", "server", "model-config.json");

    let content = JSON.parse(fs.readFileSync(modelConfigPath));

    content[modelName] = {
      "dataSource": datasourceName,
      "public": true
    };

    fs.writeFileSync(modelConfigPath, JSON.stringify(content, null, "\t"));

  }

  const loadCSV = async (file) => {

    const content = fs.readFileSync(file);

    try {
      const csv = Buffer.from(content, 'base64').toString('utf-8');

      const fileData = await csvToJson({
        checkType: true,
      }).fromString(csv);

      return fileData;

    } catch (error) {
      const err = new Error(error)
      throw err;
    }
  }

  var download = function(url, dest, cb) {
    var file = fs.createWriteStream(dest);
    var request = https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(cb);
      });
    });
  }

  Storage.importAccounts = function(storageId, body, cb) {

    Storage.getStorageModel(storageId, 'account', (err, model) => {

      if (!body.url) return cb("url not provided");

      logger.info("download file:" + body.url);

      download(body.url, path.resolve(__dirname, "accounts.csv"), function(err){

        if (err) {
          return cb(err, err);
        }

        logger.info("file downloaded...");

        const accounts = loadCSV(path.resolve(__dirname, "accounts.csv")).then((accounts)=>{
          model.create(accounts, cb);
        }).catch((err) => {
          cb(err, false)
        });
      })
    })
  };

  Storage.remoteMethod('importAccounts', {
      accepts: [
        { arg: 'storageId', type: 'string', required: true},
        { arg: 'body', type: 'object', http: { source: 'body' } }
      ],
      http: {
        path: '/:storageId/account/import',
        verb: 'post'
      },
      returns: {
        arg: 'status',
        type: 'string'
      }
    }
  );

  Storage.getOneAccount = function(storageId, accountId, cb) {
    try {
      Storage.getStorageModel(storageId, 'account', (err, model) => {
        if(err) return cb(err, null);
        if(!model) return cb("no such model", null);
        const result = model.find({ "where" : { "id" : accountId }}, function(err, result){
          cb(false, result[0]);
        });
      })
    } catch (e) {
      return cb("no such model", null);
    }

  };

  Storage.remoteMethod('getOneAccount', {
    accepts: [
      { arg: 'storageId', type: 'string', required: true },
      { arg: 'accountId', type: 'string', required: true }
    ],
    http: {
      path: '/:storageId/account/:accountId',
      verb: 'get'
    },
    returns: {
      arg: 'account',
      type: 'object'
    }
  });

  Storage.createOrUpdateAccount = (storageId, body, cb) => {

    Storage.getStorageModel(storageId, 'account', (err, model) => {
      if (body.id) {
        model.findById(body.id, (err, oldData) => {
          if (err) cb(err, null);
          return model.update({ id: body.id }, body, (err, data) => err ? cb(err, null) : cb(null, data));
        });
      } else {
        return model.create(body, (err, data) => err ? cb(err, null) : cb(null, data));
      }
    });
  };

  Storage.remoteMethod('createOrUpdateAccount', {
    accepts: [
      { arg: 'storageId', type: 'string', required: true },
      { arg: 'body', type: 'object', http: { source: 'body' } }
    ],
    http: {
      path: '/:storageId/account',
      verb: 'post'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });

  Storage.deleteOneAccount = (storageId, accountId, cb) => {

    Storage.getStorageModel(storageId, 'account', (err, model) => {

      if (err) return cb(err, null);
      if (!model) return cb("model not exist", null);

      model.destroyById(accountId, cb)
    });

  };
  Storage.remoteMethod('deleteOneAccount', {
    accepts: [
      { arg: 'storageId', type: 'number', required: true },
      { arg: 'accountId', type: 'string', required: true }
    ],
    http: {
      path: '/:storageId/account/:accountId',
      verb: 'delete'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });

  Storage.getAllAccounts = (storageId, cb) => {

    Storage.getStorageModel(storageId, 'account', (err, model) => {

      if (err) return cb(err, null);
      if (!model) return cb("account model not exist", null);

      model.find({}, cb);
    });

  }

  Storage.remoteMethod('getAllAccounts', {
    accepts: [
      { arg: 'storageId', type: 'number', required: true }
    ],
    http: {
      path: '/:storageId/account',
      verb: 'get'
    },
    returns: {
      arg: 'result',
      type: 'array'
    }
  });

  Storage.createOrUpdateTask = (id, accountId, body, cb) => {
    Storage.getStorageModel(id, 'task', (err, model, prefix) => {
      if (err || !model) {
        return cb(err, model);
      }
      Storage.app.models[prefix + '_account'].findById(accountId, (err, data) => {
        if (err || !data) {
          return cb(err, null);
        }
        if (body.id) {
          model.findById(body.id, (err, oldData) => {
            if (err) cb(err, null);
            body.taskMessages = {
              ...oldData.taskMessages,
              ...body.taskMessages
            };
            return model.update({ id: body.id, profileKey: data.profileKey }, body, (err, data) => err ? cb(err, []) : cb(null, data));
          });
        } else {
          return model.create({ ...body, profileKey: data.profileKey }, (err, data) => err ? cb(err, []) : cb(null, data));
        }
      });
    });
  };
  Storage.remoteMethod('createOrUpdateTask', {
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'accountId', type: 'number', required: true },
      { arg: 'body', type: 'object', http: { source: 'body' } }
    ],
    http: {
      path: '/:id/account/:accountId/tasks',
      verb: 'post'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });

  Storage.getAllTasks = (id, accountId, cb) => {
    Storage.getStorageModel(id, 'task', (err, model, prefix) => {
      if (err || !model) {
        return cb(err, model);
      }
      Storage.app.models[prefix + '_account'].findById(accountId, (err, data) => {
        if (err || !data) {
          return cb(err, data);
        }
        return model.find({ profileKey: data.profileKey }, (err, data) => err ? cb(err, []) : cb(null, data));
      });
    });
  };
  Storage.remoteMethod('getAllTasks', {
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'accountId', type: 'number', required: true }
    ],
    http: {
      path: '/:id/account/:accountId/tasks',
      verb: 'get'
    },
    returns: {
      arg: 'result',
      type: 'array'
    }
  });

  Storage.deleteAllTasks = (id, accountId, cb) => {
    Storage.getStorageModel(id, 'task', (err, model, prefix) => {
      if (err || !model) {
        return cb(err, model);
      }
       Storage.app.models[prefix + '_account'].findById(accountId, (err, data)=> {
        if (err || !data) {
          return cb(err, null);
        }
        return model.destroyAll({ profileKey: data.profileKey }, (err, data) => err ? cb(err, null) : cb(null, data));
      });
    });
  };
  Storage.remoteMethod('deleteAllTasks', {
    accepts: [
      { arg: 'id', type: 'string', required: true },
      { arg: 'accountId', type: 'number', required: true }
    ],
    http: {
      path: '/:id/account/:accountId/tasks',
      verb: 'delete'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });

  // data controller
  Storage.createOrUpdateData = (storageId, tableName, body, cb) => {
    Storage.getStorageModel(storageId, tableName, (err, model) => {
      if (err || !model) {
        return cb(err, model);
      }
      return model.replaceOrCreate(body, (err, data) => cb(err, data));
    });
  }
  Storage.remoteMethod('createOrUpdateData', {
    accepts: [
      { arg: 'storageId', type: 'string', required: true },
      { arg: 'tableName', type: 'string', required: true },
      { arg: 'body', type: 'object', http: { source: 'body' } }
    ],
    http: {
      path: '/:storageId/:tableName/data',
      verb: 'post'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });

  Storage.getAllData = (storageId, tableName, cb) => {
    Storage.getStorageModel(storageId, tableName, (err, model) => {
      if (err || !model) {
        return cb(err, model);
      }
      return model.find({}, (err, data) => cb(err, data));
    });
  }
  Storage.remoteMethod('getAllData', {
    accepts: [
      { arg: 'storageId', type: 'string', required: true },
      { arg: 'tableName', type: 'string', required: true }
    ],
    http: {
      path: '/:storageId/:tableName/data',
      verb: 'get'
    },
    returns: {
      arg: 'result',
      type: 'array'
    }
  });

  Storage.deleteAllData = (storageId, tableName, cb) => {
    Storage.getStorageModel(storageId, tableName, (err, model) => {
      if (err || !model) {
        return cb(err, model);
      }
      return model.destroyAll({}, (err, data) => cb(err, data));
    });
  }
  Storage.remoteMethod('deleteAllData', {
    accepts: [
      { arg: 'storageId', type: 'string', required: true },
      { arg: 'tableName', type: 'string', required: true }
    ],
    http: {
      path: '/:storageId/:tableName/data',
      verb: 'delete'
    },
    returns: {
      arg: 'result',
      type: 'object'
    }
  });
};
