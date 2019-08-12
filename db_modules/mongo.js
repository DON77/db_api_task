'use strict';

const fs = require('fs');
const csvToJson = require('csvtojson');
const path = require('path');

const mongoClient = require('mongodb').MongoClient;

module.exports = function(dbSettings){

  this.dbSettings = dbSettings;

  this.createStructure =  async () => {

    //fs.readFile(__dirname, "accountModel.json");

    return true;
  }

  this.importAccounts = async (file) => {

    console.log("import mongo accounts");

    const self = this;

    const filePath = path.resolve(__dirname, "..", "db_modules", "test" + ".csv");

    console.log("file path:", filePath);

    const content = await this.loadCSV(filePath);

    console.log("dbSettings:");
    console.log(this.dbSettings);

    let url = 'mongodb://' + this.dbSettings.DbIp + ':' + this.dbSettings.DbPort;

    mongoClient.connect(url, function(err, client) {

      console.log(err)

      var db = client.db(self.dbSettings.DbName);

      const collection = db.collection(self.dbSettings.DbPrefixTable + "_accounts");

      try {

        console.log("insertMany:");
        console.log(content);

        collection.insertMany(content);
      } catch (e) {
        console.log("insert error:");
        console.log(e);
      }

      //mongoClient.close();

    });


    /*
    try {
      db.products.insertMany( [
        { item: "card", qty: 15 },
        { item: "envelope", qty: 20 },
        { item: "stamps" , qty: 30 }
      ] );
    } catch (e) {
      print (e);
    }
    */

  }

  this.loadCSV = async (file) => {

    console.log("this.loadCSV");

    const content = fs.readFileSync(file);

    try {
      const csv = Buffer.from(content, 'base64').toString('utf-8');

      console.log("csv:");
      console.log(csv);

      const fileData = await csvToJson({
        checkType: true,
      }).fromString(csv);

      console.log("file data:");
      console.log(fileData);

      return fileData;

    } catch (error) {
      // handle error
    }
  }

  //return this;
};

