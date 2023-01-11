import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
import { Configuration, OpenAIApi } from 'openai';
const __dirname = path.dirname('.');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve('.env')});
console.log(env);

const apiKey = env.parsed.APIKEY
console.log("Using API Key: ", apiKey);
const client = new docParser.Client(apiKey); // api key
const fsFolder = env.parsed.FSEOBFOLDER;
console.log("@Subdirectory: ", fsFolder);
const parserId = env.parsed.EOBPARSERID
const jsonFolder = fsFolder + 'json/';
const connStr = env.parsed.CONNECTION_STRING;

const eobModel001 = env.parsed.EOBAIMODEL001;
const eobModel001_2 = env.parsed.EOBAIMODEL001_2;
const eobModel002 = env.parsed.EOBAIMODEL002;
const eobSearchModel001 = env.parsed.EOBAISEARCHMODEL001;
const eobSearchModel001_2 = env.parsed.EOBAISEARCHMODEL001_2;

client.ping().then(function(){
    console.log('Connection to DocParser API established.');
}).catch(function(err){
    console.log('Error: ', err);
});

const parsers = await client.getParsers()
    .then(function (parsers) {
        console.log("Found Parsers: ", parsers);
        return parsers;
    }).catch(function (err) {console.log(err)});


async function findParserbyId (ps, pid) {
    for(var i = 0; i < ps.length; i++) {
        if( ps[i].id === pid ) {
            console.log("Found parser: ", ps[i]);
            return ps[i];
        }
    }
}

const parser = await findParserbyId(parsers, parserId);

function getData(parserId) {
    // option parameters:
    // list: "last_uploaded, uploaded_after, processed_after some date"
    // limit: number, max 10,000
    //
    client.getResultsByParser(parserId, {format: 'object'})
    .then(function (result) {
        console.log(result)
    })
    .catch(function (err) {
        console.log(err)
    });
}

function isDir(path) {
    try {
        var stat = fs.lstatSync(path);
        return stat.isDirectory();
    } catch (e) {
        // lstatSync throws an error if path doesn't exist
        return false;
    }
}

// client.uploadFileByPath('PARSER_ID', './test.pdf', {remote_id: guid})
// const pattern = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i')

/* split by the first char then grab the second element which should be the rest substring of str minus the first char*/
async function recParse(str) {
	try {
		let j = JSON.parse(str);
		if(typeof j === 'object') {
			console.log("Parsed data_json: ", j);
			return await j;
		}
	}
	catch(e) {
		if(e) {
			if(str && str.length > 0) {
				//console.log(str);
				var s = str.slice(1); 
				return await recParse(s);
				} 
				else {
					return await false;
				}
			}
		}
}

async function getResultsByDocument(parserId, docId, file, callback) {
    await client.getResultsByDocument(parserId, docId, {format: 'object'})
    .then(function (res) {
        const json = res;
        summarizeData(json, openai, instructions, finalInstructions, function(data,sArr){
	    finalizeData(data,sArr, openai, finalInstructions, function(d) {
		const jsonStr = JSON.stringify(d);
                console.log("Saving to document: ", file)
                fs.writeFile(file, jsonStr, function(err){
    		    if(err) throw err;
		    console.log("Successfully overwritten: ", file);
		    const document = fs.readFileSync(file, 'utf8');
		    const jsonData = JSON.parse(document);
		    callback(jsonData[0]);
	    	});
            });        
    	});
    })	 
    .catch(function (err) {
        console.log(err);
        return false;
    });
}

// Connect to mongodb and ingest the data to EOB.Steelgem database
async function main(data, cStr, j, fp, f) {
    console.log("Connecting to MongoDB: ", cStr);
    const client = new mongodb.MongoClient(cStr);
    try {
        await client.connect();
        const db = await client.db("Steelgem");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("EOB");
        console.log("Collection: ", rc.collectionName);
        const query = { document_id: data["document_id"] };
        const update = { $set: data };
        const options = { upsert:true };
	await rc.updateOne(query, update, options).then(function (result){
	console.log(result);
        const json_processed = path.resolve(j + 'processed_json/' + f);
           fs.rename(fp, json_processed, function(err) {
               if(err) throw err;
    	       console.log("Successfully moved " + fp + " to" + json_processed);
           });
        }).catch(err => console.log(err));
    }
    catch(err) {
        console.log(err);
    }
    finally {
        await client.close();
    }
}

const configuration = new Configuration({
    apiKey: env.parsed.OPENAIAPIKEY,
    echo: false
});

const openai = new OpenAIApi(configuration);

/* 					THE PROMPT					          */
const instructions = "<instructions>\n0) Perform the following tasks on the data enclosed in '<data>' ending with '</data>' (DO NOT include or regurgitate any of the '<instructions>' in your response nor provide any feedback regarding actions taken. Evaluate instructions 1,2,3,4,5 and respond only to instruction 6):\n1) Tokenize each word and assign numerical values to each word to create relationships within the <data> and to create a vector representations of each word to aid in semantic searching of the text. Identify key and value pairings and recoginize tables in the form of running text that is made up of column headers followed by rows of data. \n2) Search for key terms belonging to an insurance policy, insurance claim, explanation of benefits, remittance advice and or patient information. Then extract information such as payee, medical provider, claim number or id, authorization number, code or status, patient name, patient id, dates, services, charges, totals and or balances, and insurance policy id or member id and etc to create a record suitable for a SQL database. Each record must have the following fields: provider and or provider id, payee and or payee id, claim number or id, authorization status, code and or number, insurance policy id or member id, dates of service, charges, totals and or balances, patient name and or patient id. Records can be grouped under the same patient name, patient id and or insurance policy number or member id.\n3) Classify each record as either an explanation of benefits, remittance advice or reimbursement (overpay).\n4) For any policy, briefly summarize the policy, highlighting grace periods, coverage, and or appeals. Disregard any legalities, prohibits and or disclosures.\n5) Validate and summarize your work by answering the following questions: How many claim items or patient records are there and what are their IDs and or authorization codes? Has the claim been denied or approved? Who are the payers and how much do they each owe and or are there any outstanding balances? Who are the payees and providers and are there any requirements needed to be resolved? Lastly when was the claim sent or when was the claim received?\n6)Only return the records created or if no record exists return a summary of the data in your response.\n</instructions>\n\n";
const finalInstructions = "<instructions>\n0) Perform the following tasks on the data enclosed in '<data>' ending with '</data>' (DO NOT include or regurgitate any of the <instructions> as part of your response nor provide any feedback regarding actions taken. Evaluate instruction 1 and respond only to instruction 2):\n1) Create an embedding of the data to use as a look up table to parse and transform any claim or patient record into a proper JSON object. The following fields are required and must be present within the JSON object: classification, medical provider, payee, claim id or number, authorization code and or number, patient name, patient id, insurance policy number or member id, totals, charges, and or balances, dates of service and claim status or authorization status.\n2)Return only the JSON object or objects in your response.</instructions>\n\n";

// Splits the unparsed data into equal substrings in length
function splitParagraph(paragraph, n) {
    var words = paragraph.split(' ');
    var result = [];
    var current = '';
    for (var i = 0; i < words.length; i++) {
        if (current.length + words[i].length < n) {
            current += words[i] + ' ';
        } else {
            result.push(current);
	    current = '';
	}
     }
     if (current.length > 0) {
         result.push(current);
     }
     return result;
}

let maxRetries = 3;
let sTries = maxRetries;

// Summarizes the partitioned unparsed data into parsed data sets
async function summarizeData(d, o, ins, fi, cb) {
    const data = d;
    console.log("Raw Data: ", data[0].data);
    let pgCount = data[0].page_count;
    let divisor = (Number(data[0].data.length) / Number(pgCount)).toFixed(0);
    var dataArr = [];
    if(pgCount > 1) {
	// partition the unparsed data into equal
        dataArr = splitParagraph(data[0].data, divisor); 
    }
    else {
	dataArr.push(data[0].data);
    }
    const summaryArr = [];
    for(var i = 0; i < dataArr.length; i++){
	dataArr[i] = ins + "<data>\n" + dataArr[i] + "\n</data>"; 
        //console.log("Partitioning the data ...", dataArr[i]);
    }
    try {    
        for(var i = 0; i < dataArr.length; i++) {
	    console.log("Summarizing data: ", i)	
            const openaiPrompt = dataArr[i];
            const response = await o.createCompletion({
         	model: eobModel001 ? eobModel001 : eobModel001_2,
		search_model: eobSearchModel001 ? eobSearchModel001 : eobSearchModel001_2,
                prompt: openaiPrompt,
		// controls randomness, 0 to make it deterministic, 1 more creative
                temperature: 0.777,
                max_tokens: 420,
                top_p: 1,
                best_of: 27,
                frequency_penalty: 0.327,
                presence_penalty: 0.5,
            });
            const findings = response.data;
            const choices = findings.choices;
	    console.log(choices);
            let dt = choices[0].text;
            data[0]["data_"+i] = dt; // push partitioned summaries into object
            summaryArr.push(dt);
            console.log("Waiting 30 seconds before proceeding ...");
            await new Promise(r => setTimeout(r, 30000));
        }
	await cb(data, summaryArr, o, fi, function(c){
	    c();
	});
    }
    catch(e) {
        if(e) console.log("Error on OpenAI: ", e);
	if(sTries > 0){
		sTries--;
		console.log("Waiting before trying again ...", 60000 + (60000/sTries));
		await new Promise(r => setTimeout(r, 60000 + (60000/sTries)));
		return await summarizeData(d,o,ins,fi,cb);
	}
    }
}

let fTries = maxRetries;
// Collects all the partitioned data and create a report on it
// Turn all records into JSON objects
async function finalizeData(d, sArr, o, fi, c) {
    const data = d;
    const fdArr = [];
    try {
	for(var i = 0; i < sArr.length; i++){    
            console.log("Finalizing data ...", i);
     	    const openaiPrompt = fi + "<data>\n" + sArr[i] + "\n</data>";    
            const response = await o.createCompletion({
            	model: eobModel002,
	        prompt: openaiPrompt,
        	temperature: 0.18496,
            	max_tokens: 599,
            	top_p: 1,
            	best_of: 27,
            	frequency_penalty: 0.327,
            	presence_penalty: 0.136,
        });
            const findings = response.data;
            const choices = findings.choices;
	    console.log(choices);
	    let json = await recParse(choices[0].text);
	    //data[0]["data_json_"+i] = json ? json : choices[0].text;
	    let jsonData = json ? json : choices[0].text;
	    fdArr.push(jsonData);
	    console.log("JSON Data " + i + ": ", jsonData);
	    console.log("Waiting 30 seconds before proceeding ...");
            await new Promise(r => setTimeout(r, 30000));
	}
	for(var i = 0; i < fdArr.length; i++){
	    data[0]["data_json_"+i] = fdArr[i];
	}
        data[0]["data_report"] = sArr.join("\n");
	console.log("Finalized Data", data);    
        await c(data);
    }
    catch(e) {
	if(e) console.log("Error on OpenAI: ", e);
	if(fTries > 0) {
		fTries--;
		console.log("Waiting before trying again ...", 60000 + (60000/fTries));
		await new Promise(r => setTimeout(r, 60000 + (60000/fTries)));
		return await finalizeData(d,sArr,o,fi,c);
	}
    }
}

async function runMain() {
       const files = fs.readdirSync(jsonFolder);
       for(var i = 0; i < files.length; i++) {
	   const filePath = path.resolve(jsonFolder + files[i]);
           let isDirectory = isDir(filePath);
           if(isDirectory === false) {
                console.log("Reading: ", filePath);
		const doc = fs.readFileSync(filePath, 'utf8');
		const jData = JSON.parse(doc);
		var id = '';
		if(jData[0]) {
			id = jData[0]["document_id"] ? jData[0]["document_id"] : jData["id"];
		}
		else{
			id = jData["id"];
		}
		await getResultsByDocument(parser.id, id, filePath, function(data) { 
	 	    const file_name = data.file_name.replace(".pdf", "." + id + ".json");	 
                    main(data, connStr, jsonFolder, filePath, file_name);
	   	});
		if(files.length - i > 1) {
		    console.log("Waiting 5 mins before processing the next file ...");   
		    await new Promise(r => setTimeout(r, 300000));
		}
       	    }
	}
}

function resolveAfterXMin(v,x) {
	return new Promise((resolve) => {
		console.log(v)
		setTimeout(() => {
			resolve();
		}, x);	
	});
}

async function wait(v,x) {
	try {
	    let msg = await resolveAfterXMin(v, x);
	    console.log(msg);
            return msg;
	}
	catch (err){
	   if (err) throw err;	
	}
}

function waitSync(ms) {
	const start = Date.now();
	let now = start;
        while ( (now - start) < ms ) { now = Date.now(); }
}

runMain();
