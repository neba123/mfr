#!/usr/bin/env node
'use strict'

const express = require('express')
var request = require('Promise');
const medUtils = require('openhim-mediator-utils')
const winston = require('winston')
const data_tree = require('data-tree')
const utils = require('./utils')
const fs = require('fs')
const fetch = require('node-fetch');
const date = require('date-and-time');
const Parser = require('rss-parser')

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

// Config
let config = {} // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('../config/test') : require('../config/config')
const mediatorConfig = require('../config/mediator')

let port = process.env.NODE_ENV === 'test' ? 7001 : mediatorConfig.endpoints[0].port

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp () {
  const app = express()

  app.all('*', async (req, res) => {
    winston.info(`Processing ${req.method} request on ${req.url}`)
    var collection_req = '/api/collections'
    var site_req = '/api/sites'
    var layer_req = '/fields.json'
    var organisationUnit_req = '/api/organisationUnits'
    var organisationUnitRegister_req = '/api/metadata?identifier=AUTO&importStrategy=CREATE_AND_UPDATE'
    var organisationUnitUpdate_req = '/api/metadata?identifier=AUTO&importStrategy=UPDATE'
    var organisationUnitSearch_req = '?filter=name:eq:'
    var organisationUnitSearch_req_parent = '&filter=parent.id:eq:'
    var organisationUnitSearch_req_code = '?filter=code:eq:'
    var last_added = '/last_added'
    var last_updated = '/last_updated'
    var headers = { 'content-type': 'application/json' }
    var activity_req = '/api/activity.rss';
    var dhis2_msg= '/api/messageConversations';

    var encoded = utils.doencode()
    var encodedDHIS2 = utils.doencodeDHIS2()

 
    //see the encoded and url from mediator config
    console.log(encoded);
    console.log(mediatorConfig.config.baseurl);

    let orchestrations = []
    let lastAdded
    try {
      lastAdded = await fs.readFileSync(__dirname + last_added, 'utf8')
      var dateValue = new Date(lastAdded);
      
      //Subtract three hours
      dateValue.setHours(dateValue.getHours() - 3)
      lastAdded = date.format(dateValue, 'YYYY-MM-DD HH:mm:ssZ')
      console.log("Last Added Date/time: " + lastAdded)
    } catch (err) {
      lastAdded = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, lastAdded, 
                  orchestrations, properties))
      return
    }

    let lastUpdated
    try {
      lastUpdated = await fs.readFileSync(__dirname + last_updated, 'utf8')

      dateValue = new Date(lastUpdated);
      
      //subtract three hours
      dateValue.setHours(dateValue.getHours() - 3)
      lastUpdated = date.format(dateValue, 'YYYY-MM-DD HH:mm:ssZ')
      console.log("Last Added Date/time: " + lastUpdated)
    } catch (err) {
      lastUpdated = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, lastUpdated, 
                orchestrations, properties))
      return
    }


  /*****************************************
      FETCH COLLECTION INFORMATION
      Connects to MFR API for collections
  ******************************************/

   
   let mfrCollectionsResponseBody
   let collections_data

    try{
      collections_data = await fetch(mediatorConfig.config.baseurl + collection_req + '.json', {
        method: "GET",
        headers: {
          "Authorization":"Basic " + encoded
        }
      });
    } catch (err) {
      mfrCollectionsResponseBody = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrCollectionsResponseBody, 
                orchestrations, properties))
      return
    }

    var collections = await collections_data.json();
    //console.log(collections);
    if (typeof collections.error !== 'undefined') {
      mfrCollectionsResponseBody = collections.error;
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrCollectionsResponseBody, 
                orchestrations, properties))
      return
    }
    
    var responseBody = JSON.stringify(collections)
    
    // capture orchestration data
    var orchestrationResponse = { statusCode: 200, headers: headers }
    //let orchestrations = []
    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, 
                      req.url, req.headers, req.body, orchestrationResponse, responseBody))


    var collection_id
    //As there may be more than one collection info
    //We need to see which one to pick for the ID. Lets assume the one
    //with the name 'Ethiopia Health Facility Registry' is required to be used
    
    for(var collection of collections) {
      var collection_name = collection.name
      if(collection_name == mediatorConfig.config.collectionname) {
        collection_id = collection.id
        break
      }    
    }
    console.log("Collection ID: " + collection_id)

    /**************************************
         FETCH LAYER INFORMATION
         Connects to MFR API for layers
    ***************************************/
/*
    let mfrLayersResponseBody
    try{
      //Fetch layer detail
      var layer_detail = await fetch(mediatorConfig.config.baseurl + collection_req + '/' + 
                                    collection_id + layer_req, {
        method: "GET",
        headers: {
          "Authorization":"Basic " + encoded
        }
      })
    } catch (err) {
      mfrLayersResponseBody = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrLayersResponseBody, 
                orchestrations, properties))
      return
    }

    var layer = await layer_detail.json();
    if (typeof layer.error !== 'undefined') {
      mfrLayersResponseBody = layer.error;
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrLayersResponseBody, 
                orchestrations, properties))
      return
    }

    responseBody = JSON.stringify(layer)
    
    // capture orchestration data
    var orchestrationResponse = { statusCode: 200, headers: headers }
    //let orchestrations = []
    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, 
                      req.url, req.headers, req.body, orchestrationResponse, responseBody))
    
      
  /*****************************************
    BUILD TREE FOR THE LAYER HIERARCHY
    use data-tree npm
  ******************************************/
  /*
    let hierarchy
    for(var layer_element of layer) {
      if(layer_element.name == 'General Information of the Facility') {
        var layer_fields = layer_element.fields
        for(var layer_field of layer_fields) {
          if(layer_field.name == 'Administrative Health Hierarchy') {
            hierarchy = layer_field.config.hierarchy
            break
          }
        }
      }    
    }

    var tree = dataTree.create()
    
    //Fetch ID of root node
    let mfrRootSiteResponseBody
    try{
      //Fetch layer detail
      var root_detail = await fetch(mediatorConfig.config.baseurl + collection_req + '/' + 
                                    collection_id + '.json?name=' + utils.returnCorrectName(utils.returnRootNodeName()), {
        method: "GET",
        headers: {
          "Authorization":"Basic " + encoded
        }
      })
    } catch (err) {
      mfrRootSiteResponseBody = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrRootSiteResponseBody, 
                orchestrations, properties))
      return
    }

    var mfrRootDetail = await root_detail.json();
    var mfrRoot = mfrRootDetail.sites[0];

    var rootNode = tree.insert({
      key: mfrRoot.id,
      value: {name: utils.returnCorrectName(utils.returnRootNodeName())}
    })

    console.log("Root Node-----ID: " + mfrRoot.id + ", Name: " + utils.returnCorrectName(utils.returnRootNodeName()))

    //Work on the rest of the nodes under the root node
    let reports_to
    for(var i = 0; i< hierarchy.length; i++) {
      reports_to = mfrRoot.id
      //Fetch ID of root node
      let mfrNodeSiteResponseBody
      try{
        //Fetch layer detail
        var node_detail = await fetch(mediatorConfig.config.baseurl + collection_req + '/' + 
                                      collection_id + '.json?name=' + utils.returnCorrectName(hierarchy[i].name) + 
                                      '&reports_to=' + reports_to, {
          method: "GET",
          headers: {
            "Authorization":"Basic " + encoded
          }
        })
      } catch (err) {
        mfrNodeSiteResponseBody = err.message
        const headers = { 'content-type': 'application/text' }

        // set content type header so that OpenHIM knows how to handle the response
        res.set('Content-Type', 'application/json+openhim')

        // construct return object
        res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrNodeSiteResponseBody, 
                  orchestrations, properties))
        return
      }

      var mfrNodeDetail = await node_detail.json();
      var nodeDescription = mfrNodeDetail.sites[0];

      console.log("nodeDescription: " + JSON.stringify(nodeDescription))
      

      //Create the child node and insert it under the root node
      var subNode = tree.insertToNode(rootNode, {
        key: nodeDescription.id,
        value: {name: nodeDescription.name}
      })
      console.log("\n#################Key: " + nodeDescription.id + ", Name: " + nodeDescription.name)
      
      var hierarchy_sub = hierarchy[i].sub;     
      for(var j = 0; j < hierarchy_sub.length; j++) {

        reports_to = nodeDescription.id
        //Fetch ID of root node
        let mfrSubNodeSiteResponseBody
        try{
          //Fetch layer detail
          console.log("\n\n+++++++++++++++++++++++++++++++++++++++++++++\n" + mediatorConfig.config.baseurl + collection_req + '/' + 
                      collection_id + '.json?name=' + utils.returnCorrectName(hierarchy_sub[j].name) + '&reports_to=' + reports_to)
          var subNode_detail = await fetch(mediatorConfig.config.baseurl + collection_req + '/' + 
                                        collection_id + '.json?name=' + utils.returnCorrectName(hierarchy_sub[j].name) + 
                                        '&reports_to=' + reports_to, {
            method: "GET",
            headers: {
              "Authorization":"Basic " + encoded
            }
          })
        } catch (err) {
          mfrSubNodeSiteResponseBody = err.message
          const headers = { 'content-type': 'application/text' }

          // set content type header so that OpenHIM knows how to handle the response
          res.set('Content-Type', 'application/json+openhim')

          // construct return object
          res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSubNodeSiteResponseBody, 
                    orchestrations, properties))
          return
        }

        var mfrSubNodeDetail = await subNode_detail.json();
        console.log("\n\n=========================================================\nmfrSubNodeDetail: " + 
                    JSON.stringify(mfrSubNodeDetail))
        if(mfrSubNodeDetail.count > 0) {
          var subNodeDescription = mfrSubNodeDetail.sites[0];
          //Create the child node and insert it under the the sub root node
          var subSubNode = tree.insertToNode(subNode, {
            key: subNodeDescription.id,
            value: {name: subNodeDescription.name}
          })
          console.log("\n#################Key: " + subNodeDescription.id + ", Name: " + subNodeDescription.name)
        }
        reports_to = subNodeDescription.id
        var hierarchysub_sub = hierarchy_sub[j].sub;     
        if(hierarchysub_sub && hierarchysub_sub != null) {
          for(var k = 0; k < hierarchysub_sub.length; k++) {
            //Fetch ID of root node
            let mfrSubSubNodeSiteResponseBody
            try{
              //Fetch layer detail
              console.log("\n\n+++++++++++++++++++++++++++++++++++++++++++++\n" + mediatorConfig.config.baseurl + 
                          collection_req + '/' + collection_id + '.json?name=' + utils.returnCorrectName(hierarchysub_sub[k].name) + 
                          '&reports_to=' + reports_to)
              var subSubNode_detail = await fetch(mediatorConfig.config.baseurl + collection_req + '/' + 
                                            collection_id + '.json?name=' + utils.returnCorrectName(hierarchysub_sub[k].name) + 
                                            '&reports_to=' + reports_to, {
                method: "GET",
                headers: {
                  "Authorization":"Basic " + encoded
                }
              })
            } catch (err) {
              mfrSubSubNodeSiteResponseBody = err.message
              const headers = { 'content-type': 'application/text' }

              // set content type header so that OpenHIM knows how to handle the response
              res.set('Content-Type', 'application/json+openhim')

              // construct return object
              res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSubSubNodeSiteResponseBody, 
                        orchestrations, properties))
              return
            }

            var mfrSubSubNodeDetail = await subSubNode_detail.json();
            console.log("\n\n=========================================================\mfrSubSubNodeDetail: " + 
                        JSON.stringify(mfrSubSubNodeDetail))
            if(mfrSubSubNodeDetail.count > 0) {
              var subSubNodeDescription = mfrSubSubNodeDetail.sites[0];
              //Create the child node and insert it under the the sub root node
              var subSubSubNode = tree.insertToNode(subSubNode, {
                key: subSubNodeDescription.id,
                value: {name: subSubNodeDescription.name}
              })
              console.log("\n#################Key: " + subSubNodeDescription.id + ", Name: " + subSubNodeDescription.name)
            }
          }
        }
        
      }
    }

    responseBody = "Tree Structure Generated!"
    
    // capture orchestration data
    var orchestrationResponse = { statusCode: 200, headers: headers }
    //let orchestrations = []
    orchestrations.push(utils.buildOrchestration('MFR Hierarchy', new Date().getTime(), req.method, 
                      req.url, req.headers, req.body, orchestrationResponse, responseBody))
    

    /*****************************************
      SYNC THE MFR HIERARCHY WITH DHIS2
      use data-tree npm and the already 
      constructed tree structure
    ******************************************/
/*
    let return_data
    //var i = 0;
    const sleep = (milliseconds) => {
      return new Promise(resolve => setTimeout(resolve, milliseconds))
    }
    
    var treeArray = []
    tree.traverser().traverseBFS(function(node){
      var nodeToInsert = null
      var nodeKey = node.data().key
      var nodeName = node.data().value.name
      var parentKey = node.parentNode() == null ? '' : node.parentNode().data().key
      var parentName = node.parentNode() == null ? '' : node.parentNode().data().value.name
      
      var nodeArray = {
        node_key: nodeKey,
        node_name: nodeName,
        parent_key: parentKey,
        parent_name: parentName
      }
      
      treeArray.push(nodeArray)
    })
    for(var m=0; m < treeArray.length; m++) {
    //treeArray.forEach(async function(element) {
      //console.log("****************In traverser********" + JSON.stringify(treeArray))
      if(treeArray[m]['parent_key'] == '') { //Root node
        //Fetch organisation unit information
        try{
          var ou_detail =  await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                          organisationUnitSearch_req_code + treeArray[m]['node_key'], {
          method: "GET",
          headers: {
            "Authorization":"Basic " + encodedDHIS2
          }
          })
        
          .then(response => response.json())
          .then(function handleData(data) {
            return_data = data;
          })
        } catch(err) {
          console.log("In Root Node - Fetch Organisation unit info: " + err)
          return
        }
        
        //console.log("*************" + JSON.stringify(return_data) + "**************");
        if(return_data && return_data.organisationUnits.length == 0) { //node does not exist
          console.log("XXXXXXXXXXXXXXXXXRoot node does NOT exist: " + treeArray[m]['node_key'])
          var nodeToInsert = {
              "name": "Federal Ministry of Health", 
              "openingDate": '1980-06-15',
              "shortName": utils.returnShortName('Federal Ministry of Health'),
              "code": treeArray[m]['node_key']
          }
        }
      } else {
        //Fetch organisation unit information
        
        var ou_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req +  
                        organisationUnitSearch_req_code + treeArray[m]['node_key'], {
          method: "GET",
          headers: {
          "Authorization":"Basic " + encodedDHIS2
          }
        })
        .catch((err) => { 
          console.log("In branch Node - Fetch Organisation unit info: " + err)
          return
        })
        .then(response => response.json())
        .then(function handleData(data) {
          return_data = data;
        })
        //console.log("*************" + JSON.stringify(return_data) + "**************");
        if(return_data && return_data.organisationUnits.length == 0) { //node does not exist
          //Fetch parent  organisation unit information
          console.log("XXXXXXXXXXXXXXXXXNode does NOT exist: " + treeArray[m]['node_key'] + " - Get the parent")
          
          var ou_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                organisationUnitSearch_req_code + treeArray[m]['parent_key'], {
            method: "GET",
            headers: {
              "Authorization":"Basic " + encodedDHIS2
              }
          })
          .catch((err) => {
            console.log("In branch Node - Fetch Organisation unit parent info: " + err)
            return
          })
          .then(response => response.json())
          .then(function handleData(data) {
            return_data = data;
          })
          
          //console.log("*************" + JSON.stringify(return_data) + "**************");
           //console.log()
          if(return_data && return_data.organisationUnits.length > 0) {
            console.log("%%%%%%%" + mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                        organisationUnitSearch_req_code + treeArray[m]['parent_key'] + "%%%%%%%")
            console.log("%%%%%%%%" + JSON.stringify(return_data) + "%%%%%%%%")
            var nodeToInsert = {
              "name": treeArray[m]['node_name'],
              "openingDate": '1980-06-15',
              "shortName": utils.returnShortName(treeArray[m]['node_name']),
              "code": treeArray[m]['node_key'],
              "parent":{
                "id": return_data.organisationUnits[0].id
              }
            }
          }
        }
      }

      console.log("!!!!!!!!!!!!!!!!!!!!!!Node to insert" + (nodeToInsert == null ? "Already available!" : nodeToInsert))

      if(nodeToInsert != null){
      //Add new parent Organisation Unit
      
        var insert_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req, {
          method: "POST",
          headers: {
            "Authorization":"Basic " + encodedDHIS2,
            "Content-Type":"application/json"
          },
          body: JSON.stringify(nodeToInsert)
        
        })
        .catch((err) => {
          console.log("Register Organisation unit info: " + err)
          return
        })
        .then(response => response.json())
        .then(function handleData(data) {
          return_data = data;
        })
        console.log("*************" + JSON.stringify(return_data) + "**************");
      }
      
  }
  
  var responseBody = JSON.stringify(return_data)
    
  // capture orchestration data
  var orchestrationResponse = { statusCode: 200, headers: headers }
  //let orchestrations = []
  orchestrations.push(utils.buildOrchestration('Hierarchy Sync DHIS2', new Date().getTime(), req.method, 
                      req.url, req.headers, req.body, orchestrationResponse, responseBody))

*/
  /******************************************
      FETCH SITE DETAIL INFORMATION
      Connects to MFR API for site detail
  *******************************************/
   let return_data
   let mfrSiteDetailResponseBody
   var fetchURL = mediatorConfig.config.baseurl + collection_req + '/' + 
                  collection_id + '.json' + '?created_since=' + lastAdded + '&page=1'
   //var nextPage = true

   while(fetchURL) {
     console.log("^^^^^^^^^^^" + fetchURL + "^^^^^^^^^^")
    try{
      //Fetch site detail
      var site_detail = await fetch(fetchURL, {
        method: "GET",
        headers: {
          "Authorization":"Basic " + encoded
        }
      });
    } catch (err) {
      mfrSiteDetailResponseBody = err.message
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSiteDetailResponseBody, 
                orchestrations, properties))
      return
    }

    var sites = await site_detail.json();
    
    console.log("^^^^^^^^^Site Detail: ^^^^^^^^^^" + JSON.stringify(sites))
    if (typeof sites.error !== 'undefined') {
      mfrSiteDetailResponseBody = sites.error;
      const headers = { 'content-type': 'application/text' }

      // set content type header so that OpenHIM knows how to handle the response
      res.set('Content-Type', 'application/json+openhim')

      // construct return object
      res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSiteDetailResponseBody, 
                orchestrations, properties))
      return
    }

    responseBody = JSON.stringify(sites)
    
    // capture orchestration data
    var orchestrationResponse = { statusCode: sites.status, headers: headers }
    //let orchestrations = []
    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, 
                      req.url, req.headers, req.body, orchestrationResponse, responseBody))
      

    /*****************************************
      SYNC NEWLY ADDED FACILITITES
      Connects to MFR API for facilities and
      writes them to DHIS2
    ******************************************/
    
    let organisationUnits = []
    var site_array = sites.sites
    
    for(var n = 0; n < site_array.length; n++) {
      var facilities_to_add = []
      var facility = site_array[n]

      console.log(JSON.stringify(facility))

      var parent_id = ""
      while(typeof facility.id !== 'undefined') {
        //Fetch organisation unit information
        var ou_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                  organisationUnitSearch_req_code + facility.id, {
          method: "GET",
          headers: {
            "Authorization":"Basic " + encodedDHIS2
          }
        })
        .then(response => response.json())
        .then(function handleData(data) {
          return_data = data;
        })
        if(return_data.organisationUnits.length == 0) { //Not found in DHIS2
          //Check for phcu case
          if((typeof facility.properties.isphcu !== 'undefined') && facility.properties.isphcu) {
            if((typeof facility.properties.phcuparentid !== 'undefined')) {
              var opening_date
              if(typeof facility.properties.year_opened !== 'undefined') {
                var date_arr = facility.properties.year_opened.split("/");
                opening_date = date_arr[2] + '-' + date_arr[1] + '-' + date_arr[0]
              } else {
                opening_date = '1980-06-15'
              }                                  
              facilities_to_add.push(
                {
                  "name": facility.name,
                  "openingDate": opening_date,
                  "shortName": utils.returnShortName(facility.name),
                  "code": facility.id,
                  "phcuStatus": "child",
                  "phcuParentId": facility.properties.phcuparentid
                }
              )
            } else {
              var opening_date
              if(typeof facility.properties.year_opened !== 'undefined') {
                var date_arr = facility.properties.year_opened.split("/");
                opening_date = date_arr[2] + '-' + date_arr[1] + '-' + date_arr[0]
              } else {
                opening_date = '1980-06-15'
              }
              facilities_to_add.push(
                {
                  "name": facility.name,
                  "openingDate": opening_date,
                  "shortName": utils.returnShortName(facility.name),
                  "code": facility.id,
                  "phcuStatus": "parent"
                }
              )
            }
          } else {
            var opening_date
            if(typeof facility.properties.year_opened !== 'undefined') {
              var date_arr = facility.properties.year_opened.split("/");
              opening_date = date_arr[2] + '-' + date_arr[1] + '-' + date_arr[0]
            } else {
              opening_date = '1980-06-15'
            }
            facilities_to_add.push(
              {
                "name": facility.name,
                "openingDate": opening_date,
                "shortName": utils.returnShortName(facility.name),
                "code": facility.id
              }
            )
          }
          console.log("\n!!!!!!!!!!!Facilities To Add: !!!!!!!!!!!!!!!!!" + 
                JSON.stringify(facilities_to_add))
          let mfrResponseBody
        
          console.log("^^^^^^^^^^^" + mediatorConfig.config.baseurl + site_req + '/' + 
                            facility.properties.reports_to + '.json' + "^^^^^^^^^^")
          try{
            //Fetch site detail
            var parent_site_detail = await fetch(mediatorConfig.config.baseurl + site_req + '/' + 
                                              facility.properties.reports_to + '.json', {
              method: "GET",
              headers: {
                "Authorization":"Basic " + encoded
              }
            });
          } catch (err) {
            mfrResponseBody = err.message
            const headers = { 'content-type': 'application/text' }

            // set content type header so that OpenHIM knows how to handle the response
            res.set('Content-Type', 'application/json+openhim')

            // construct return object
            res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrResponseBody, 
                      orchestrations, properties))
            return
          }

          var parent_site = await parent_site_detail.json();
          facility = parent_site
        } else {
          facility = ""
          if(facilities_to_add.length > 0) {
            parent_id = return_data.organisationUnits[0].id
          }
        }
      }
      
      var organisationUnit_to_add
      var insert_detail
      var ou_phcu
      for(var i = facilities_to_add.length - 1; i >= 0; i--) { //Register the organisation units on DHIS2
        //Handle PHCU Cases
        if(typeof facilities_to_add[i].phcuStatus !== 'undefined') {
          if(facilities_to_add[i].phcuStatus == "parent") {
            //Check to see if the PHCU already exists or not
            //Fetch organisation unit information
            ou_phcu = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                    organisationUnitSearch_req_code + facilities_to_add[i].code + "PHCU", {
            method: "GET",
            headers: {
              "Authorization":"Basic " + encodedDHIS2
            }
            })
            .then(response => response.json())
            .then(function handleData(data) {
              return_data = data;
            })
            if(return_data.organisationUnits.length == 0) { //Not found in DHIS2
              //Create the PHCU org unit
              organisationUnit_to_add = {
                "name": facilities_to_add[i].name + " PHCU",
                "openingDate": facilities_to_add[i].openingDate,
                "shortName": facilities_to_add[i].shortName + " PHCU",
                "code": facilities_to_add[i].code + "PHCU",
                "parent":{
                  "id": parent_id
                }
              }
              try{
                insert_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req, {
                  method: "POST",
                  headers: {
                    "Authorization":"Basic " + encodedDHIS2,
                    "Content-Type":"application/json"
                  },
                  body: JSON.stringify(organisationUnit_to_add)
                
                })
                .then(response => response.json())
                .then(function handleData(data) {
                  return_data = data;
                })
              } catch(err) {
                console.log("Register Organisation unit info: " + err)
                return
              }
              if(return_data.status == "OK") {
                if(return_data.response.uid) {
                  parent_id = return_data.response.uid
                  console.log("In IF{{{{{{{{{{FROM PHCU: uid: }}}}}}}}} " + parent_id)
                }
              } else {
                console.log("\n---------FROM PHCU: Could NOT register into DHIS2------------------\n");
              }  
            } else {
              parent_id = return_data.organisationUnits[0].id
            }
          } else { //If it is a child under a phcu
            //Check to see if the PHCU already exists or not
            //Fetch organisation unit information
            ou_phcu = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                      organisationUnitSearch_req_code + facilities_to_add[i].phcuParentId + "PHCU", {
            method: "GET",
            headers: {
            "Authorization":"Basic " + encodedDHIS2
            }
            })
            .then(response => response.json())
            .then(function handleData(data) {
              return_data = data;
            })
            if(return_data.organisationUnits.length == 0) { //Not found in DHIS2
              //Create the PHCU org unit
              organisationUnit_to_add = {
                "name": facilities_to_add[i].name + " PHCU",
                "openingDate": facilities_to_add[i].openingDate,
                "shortName": facilities_to_add[i].shortName + " PHCU",
                "code": facilities_to_add[i].phcuParentId + "PHCU",
                "parent":{
                  "id": parent_id
                }
              }
              try{
                insert_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req, {
                  method: "POST",
                  headers: {
                    "Authorization":"Basic " + encodedDHIS2,
                    "Content-Type":"application/json"
                  },
                  body: JSON.stringify(organisationUnit_to_add)

                })
                .then(response => response.json())
                .then(function handleData(data) {
                  return_data = data;
                })
              } catch(err) {
                console.log("Register Organisation unit info: " + err)
                return
              }
              if(return_data.status == "OK") {
                if(return_data.response.uid) {
                  parent_id = return_data.response.uid
                  console.log("In response uid{{{{{{{{{{FROM PHCU: uid: }}}}}}}}} " + parent_id)
                }
              } else {
                console.log("\n---------FROM PHCU: Could NOT register into DHIS2------------------\n");
              }  
            } else {
              parent_id = return_data.organisationUnits[0].id
            }

          }
        }
        
        
        //Add new Organisation Unit
        organisationUnit_to_add = {
          "name": facilities_to_add[i].name,
          "openingDate": facilities_to_add[i].openingDate,
          "shortName": facilities_to_add[i].shortName,
          "code": facilities_to_add[i].code,
          "parent":{
            "id": parent_id
          }
        }

        console.log("...................." + JSON.stringify(organisationUnit_to_add) + ".....................")
        try{
          insert_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req, {
            method: "POST",
            headers: {
              "Authorization":"Basic " + encodedDHIS2,
              "Content-Type":"application/json"
            },
            body: JSON.stringify(organisationUnit_to_add)
            
          })
          .then(response => response.json())
          .then(function handleData(data) {
            return_data = data;
          })
        } catch(err) {
          console.log("Register Organisation unit info: " + err)
          return
        }
        //console.log(return_data.response.errorReports)
        //responseBody = JSON.stringify(return_data);
        if(return_data.status == "OK") {
          if(return_data.response.uid) {
            parent_id = return_data.response.uid
          }
        } else {
          console.log("\n---------Could NOT register into DHIS2------------------\n");
        }

        responseBody = JSON.stringify(return_data);
        console.log(responseBody);
    
        orchestrations.push(utils.buildOrchestration('Register in DHIS2 - ' + n + ', ' + i, new Date().getTime(), req.method, req.url, 
                            req.headers, req.body, orchestrationResponse, responseBody))

      }
      
    }
    
    
    
    //Manage page
    fetchURL = sites.nextPage
  } //While loop based on nextPage ends here  
  
  
  //Update the last_added date/time
  try {
    let now = new Date();
    fs.writeFileSync(__dirname + last_added, date.format(now, 'YYYY-MM-DD HH:mm:ssZ'), 'utf8')
  } catch (err) {
    lastAdded = err.message
    const headers = { 'content-type': 'application/text' }

    // set content type header so that OpenHIM knows how to handle the response
    res.set('Content-Type', 'application/json+openhim')

    // construct return object
    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, lastAdded, 
                orchestrations, properties))
    return
  }

  
///////////////////////////////////////////////UPDATE////////////////////////////////////////

/******************************************
      FETCH SITE DETAIL INFORMATION
      Connects to MFR API for site detail
  *******************************************/
 
 mfrSiteDetailResponseBody
 fetchURL = mediatorConfig.config.baseurl + collection_req + '/' + 
                collection_id + '.json' + '?updated_since=' + lastUpdated + '&page=1'
 
 while(fetchURL) {
   console.log("^^^^^^^^^^^" + fetchURL + "^^^^^^^^^^")
  try{
    //Fetch site detail
    var site_detail = await fetch(fetchURL, {
      method: "GET",
      headers: {
        "Authorization":"Basic " + encoded
      }
    });
  } catch (err) {
    mfrSiteDetailResponseBody = err.message
    const headers = { 'content-type': 'application/text' }

    // set content type header so that OpenHIM knows how to handle the response
    res.set('Content-Type', 'application/json+openhim')

    // construct return object
    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSiteDetailResponseBody, 
              orchestrations, properties))
    return
  }

  var sites = await site_detail.json();
  
  if (typeof sites.error !== 'undefined') {
    mfrSiteDetailResponseBody = sites.error;
    const headers = { 'content-type': 'application/text' }

    // set content type header so that OpenHIM knows how to handle the response
    res.set('Content-Type', 'application/json+openhim')

    // construct return object
    res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, mfrSiteDetailResponseBody, 
              orchestrations, properties))
    return
  }

  responseBody = JSON.stringify(sites)
  
  // capture orchestration data
  orchestrationResponse = { statusCode: sites.status, headers: headers }
  //let orchestrations = []
  orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, 
                req.url, req.headers, req.body, orchestrationResponse, responseBody))
    


  /*****************************************
    SYNC UPDATED FACILITITES
    Connects to MFR API for facilities and
    updates them to DHIS2
  ******************************************/
  
  let organisationUnits = []
  for(var n = 0; n < sites.sites.length; n++) {
    
    //Fetch organisation unit information
    var ou_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                  organisationUnitSearch_req_code + 
                                  sites.sites[n].properties.reports_to, {
      method: "GET",
      headers: {
        "Authorization":"Basic " + encodedDHIS2
      }
      })
      .then(response => response.json())
      .then(function handleData(data) {
        return_data = data;
      })

    //if(return_data.organisationUnits.length > 0) {
      console.log("\n\nThe request on line# 1036: " + mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                  organisationUnitSearch_req_code + sites.sites[n].properties.reports_to);
      console.log("\nThe response: " + JSON.stringify(return_data))
    var parent_id = return_data.organisationUnits[0].id
    
    //Fetch organisation unit information
    var ou_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
                                organisationUnitSearch_req_code + 
                                sites.sites[n].id, {
      method: "GET",
      headers: {
      "Authorization":"Basic " + encodedDHIS2
      }
      })
      .then(response => response.json())
      .then(function handleData(data) {
        return_data = data;
      })

      var org_unit_id = return_data.organisationUnits[0].id

      var opening_date
      if(typeof sites.sites[n].properties.year_opened !== 'undefined') {
        var date_arr = sites.sites[n].properties.year_opened.split("/");
        opening_date = date_arr[2] + '-' + date_arr[1] + '-' + date_arr[0]
      } else {
        opening_date = '1980-06-15'
      }
      var organisationUnit = {
        "id": org_unit_id,
        "name": sites.sites[n].name, 
        "openingDate": opening_date,
        "shortName": sites.sites[n].properties.short_name ? sites.sites[n].properties.short_name : 
                      utils.returnShortName(sites.sites[n].name), 
        "latitude": sites.sites[n].lat,
        "longitude": sites.sites[n].long,
        "code": sites.sites[n].id,
        "phoneNumber": sites.sites[n].facility__official_phone_number,
        "parent":{
          "id": parent_id
        }
    }
   
    organisationUnits.push(organisationUnit)

    orchestrationResponse = {}//{ statusCode: 200, headers: headers }
    orchestrations.push(utils.buildOrchestration('Fetch specific site and do data transformation', 
                          new Date().getTime(), '', '', '', '', orchestrationResponse, 
                          JSON.stringify(organisationUnit)))
  }  

  const dhisImport = {
    "organisationUnits": organisationUnits
  }
  
  //Add new Organisation Units
  var insert_detail = await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnitUpdate_req, {
    method: "POST",
    headers: {
      "Authorization":"Basic " + encodedDHIS2,
      "Content-Type":"application/json"
    },
    body: JSON.stringify(dhisImport)
    
  })
  .then(response => response.json())
  .then(function handleData(data) {
    return_data = data;
  });

  responseBody = JSON.stringify(return_data);
  console.log(responseBody);
  
  orchestrations.push(utils.buildOrchestration('Register in DHIS2', new Date().getTime(), req.method, req.url, 
                      req.headers, req.body, orchestrationResponse, responseBody))
  
  //Manage page
  fetchURL = sites.nextPage
} //While loop based on nextPage ends here  
//Update the last_updated date/time
try {
  let now = new Date();
  fs.writeFileSync(__dirname + last_updated, date.format(now, 'YYYY-MM-DD HH:mm:ssZ'), 'utf8')
} catch (err) {
  lastUpdated = err.message
  const headers = { 'content-type': 'application/text' }

  // set content type header so that OpenHIM knows how to handle the response
  res.set('Content-Type', 'application/json+openhim')

  // construct return object
  res.send(utils.buildReturnObject(mediatorConfig.urn, 'Failed', 404, headers, lastUpdated, 
              orchestrations, properties))
  return
}

//////////////////////////////////////////////////////////////////////////////////////////////

// set content type header so that OpenHIM knows how to handle the response
res.set('Content-Type', 'application/json+openhim')

// construct return object
var properties = { property: 'Primary Route' }
res.send(utils.buildReturnObject(mediatorConfig.urn, 'Successful', 200, headers, responseBody, 
                                  orchestrations, properties))



/**
 *  Send message to DHIS2 Admin
 *
 */

let parser = new Parser({
  headers: {
      "Authorization":"Basic " + encoded
    },
  customFields: {
      item: [
          ['rm:collection','collection'],
          ['rm:itemtype','itemtype'],
          ['rm:itemid','itemid'],
          ['rm:action','action'],
      ]
  }
});

let rssfeeds= [];


//version 0.2 compare lastUpdate and pubDate
await parser.parseURL(mediatorConfig.config.baseurl + activity_req)
    .then(feed =>{ feed.items.forEach(item => rssfeeds.push(item));} )

console.log('~~~~~~~~~~~~~~~~~ ' + rssfeeds.length);

//let return_data;

for(var m=0; m < rssfeeds.length; m++) {

  var pubDate= date.format(new Date(rssfeeds[m].pubDate), 'YYYY-MM-DD HH:mm:ssZ');
  console.log('lastUpdated: ' + lastUpdated +  'pubDate '+ pubDate);

  if(pubDate >= lastUpdated){

    await fetch(mediatorConfig.config.DHIS2baseurl + organisationUnit_req + 
      organisationUnitSearch_req_code + rssfeeds[m].itemid, {
      method: "GET",
      headers: {
      "Authorization":"Basic " + encodedDHIS2
      }
      })
      .then(response => response.json())
      .then(function handleData(data) {
      return_data = data;
      })

      console.log('!!!!!!!!!!!!!!!!!!!!!!  ' + return_data.organisationUnits.length )
      if(return_data.organisationUnits.length != 0){  //if it is in DHIS2
    
        var name = return_data.organisationUnits[0].displayName
        var emailSubject;
        if(rssfeeds[m].action === 'changed')
            emailSubject= 'Facility Information Updated'
        else if (rssfeeds[m].action === 'created')
            emailSubject= 'New Facility Information Added'
        else
            emailSubject= 'INFO'
        var message= {
            "subject" : emailSubject + ' : ' + name,
            "text" : rssfeeds[m].title + ' on ' + rssfeeds[m].pubDate ,
            "users" : [
                {
                    "id": "M5zQapPyTZI"
                }
            ]
        }
        
        console.log(JSON.stringify(message));

        if(message != null){
            
            var send_msg = await fetch(mediatorConfig.config.DHIS2baseurl + dhis2_msg, {
                method: "POST",
                headers: {
                "Authorization":"Basic " + encodedDHIS2,
                "Content-Type":"application/json"
                },
                body: JSON.stringify(message)
            
            })
            .catch((err) => {
                console.log("Message send to DHIS2 Admin failed: " + err)
                return
            })
            console.log('Message sent successfuly')
        } 
      }
    }

  }




})
return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
  if (apiConf.api.trustSelfSigned) { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' }

  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:')
        winston.info(JSON.stringify(newConfig))
        config = newConfig
        if (err) {
          winston.error('Failed to fetch initial config')
          winston.error(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            if (apiConf.heartbeat) {
              let configEmitter = medUtils.activateHeartbeat(apiConf.api)
              configEmitter.on('config', (newConfig) => {
                winston.info('Received updated config:')
                winston.info(JSON.stringify(newConfig))
                // set new config for mediator
                config = newConfig

                // we can act on the new config received from the OpenHIM here
                winston.info(config)
              })
            }
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info(`Listening on ${port}...`))
}
