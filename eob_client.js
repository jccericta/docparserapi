import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
import mongodb from 'mongodb';
import { Configuration, OpenAIApi } from 'openai';
import { OpenAI } from 'gpt-x';
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

const oai = new OpenAI(env.parsed.OPENAIAPIKEY, 'Steelgem');

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
// const pattern = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i');

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
				var s = str.slice(1); // split by the first char then grab the second element which should be the rest substring of str minus the first char
				////console.log("substring: ", s);
				return await recParse(s);
				} 
				else {
					return await false;
				}
			}
		}
}

async function getDataFromDoc(pid, did) {	
	try {
	    const data = await client.getResultsByDocument(pid, did, {format: 'object'});
	    //console.log(data);
	    return data;
	}
	catch (err) {
	if (err) {
	    	console.log("Error retrieving results from DocParser: ", err);	    
	   }
	    //await new Promise(r => setTimeout(r, 300000)); // wait 5 minute then try again
	    //return await getDataFromDoc(pid, did);
	}
}

async function getResultsByDocument(parserId, docId, file, callback) {
    await client.getResultsByDocument(parserId, docId, {format: 'object'})
    .then(function (res) {
        //console.log("Retrieved DocParser Data: ", res);
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
        const db = await client.db("EOB");
        console.log("Database: ", db.databaseName);
        const rc = await db.collection("Steelgem");
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
	       //c();   
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

/* 					THE PROMPT					          */

const openai = new OpenAIApi(configuration);
const prompt = "Instruction 1) Always recompile any and all previous EOB (Explanation of Benefits) data grouped by 'Document ID'. Clean, edit and refine the EOB(Explanation of Benefits) Data by stripping off trailing whitespaces, characters, symbols, and repeating characters. \n\I "; 
const parse = "Instruction 2) Create an embedding and classify the data into Payee Name | Provider Name | Reference ID | Claim ID | Date of Service | Authorization Status or ID | Patient Name | Insurance Policy ID | Charges or Patient Responsibility | Remarks | Notes. \n\I ";
const questions = "Instruction 3) Use the classification of the data to create a record for each patient with the following fields: 'Reference ID', 'Claim ID', 'Date of Service', 'Authorization Status', 'Patient Name', 'Insurance Policy ID', 'Total Charges or Balance'. Include any policy agreement, conditions and or exclusions as 'Notes'. \n\I ";
const summary = "Instruction 4) Answer the following questions \n\I: Who is the Payee? Who is the Medical Provider? Who is the Patient? What services did patient receive? What is the total balance of charges for each patient? \n\Q. Provide a summary of any policy agreement found in the data pertaining to the patient. \n\I ";
const constraints = "Instruction 5) Constraints: Only return completions with a confidence level of 100%. You must include your confidence level for every completion. Every completion must be 100% complete and every completion must include a record for each patient by claim. Do not echo or include instructions in your completion. Disregard any legalities and or prohibits. \n\I ";
const instructions = prompt + parse + questions + summary + constraints; //add the data later
const finalInstructions = "Instruction 6) For each record, provide me a proper JSON object separating each object by a delimiter '|'. \n\I ";

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

// Summarizes the partitioned unparsed data into parsed data sets
async function summarizeData(d, o, ins, fi, cb) {
    const data = d;
    let pgCount = data[0].page_count;
    let divisor = (Number(data[0].data.length) / Number(pgCount)).toFixed(0);
    var dataArr;	
    if(divisor > 1) {
	// partition the unparsed data into equal
        dataArr = splitParagraph(data[0].data, divisor); 
    }
    else {
	dataArr = data[0].data;    
    }
    const summaryArr = [];
    console.log("Partitioning the data ...");
    try {
        for(var i = 0; i < dataArr.length; i++) {
            const openaiPrompt = "Document ID: " + data[0].document_id + " (" + i + " out of " + dataArr.length + ") EOB Data: " + dataArr[i] + " \n\D " + ins;
            const response = await o.createCompletion({
                model: "text-davinci-003",
                prompt: openaiPrompt,
                temperature: 0.777,
                max_tokens: 327,
                top_p: 1,
                best_of: 27,
                frequency_penalty: 0.87,
                presence_penalty: 0.327,
            });
            const findings = response.data;
            const choices = findings.choices;
            console.log("Summarizing data: ", i)
            //console.log(choices);
            data[0]["parsed_summary_"+i] = choices[0].text; // push partitioned summaries into object
            summaryArr.push(data[0]["parsed_summary_"+i]);
            await new Promise(r => setTimeout(r, 60000));
        }
	await cb(data, summaryArr, o, fi, function(c){
	    c();
	});
    }
    catch(e) {
        if(e) throw e;
    }
}

// Collects all the partitioned data and create a report on it
async function finalizeData(d, sArr, o, fi, c) {
    let str = sArr.join("\r\n");
    const openaiPrompt = d[0].document_id + " Compiled Data: " + str + " \n\D " + fi + " \n\I ";
    console.log("Finalizing data ...");
    try {
        const response = await o.createCompletion({
            model: "text-davinci-003",
            prompt: openaiPrompt,
            temperature: 0.327,
            max_tokens: 420,
            top_p: 1,
            best_of: 27,
            frequency_penalty: 0.18496,
            presence_penalty: 0.136,
        });
        const findings = response.data;
        const choices = findings.choices;
        const data = d;
        data[0]["data_json"] = choices[0].text;
	console.log("Finalized Data: ", data);
	await new Promise(r => setTimeout(r, 60000));
        await c(data);
    }
    catch(e) {
        if(e) throw e;
    }
}

async function runMain() {
       try {
           fs.readdir(jsonFolder, (err, files)  => {
	   files.forEach(async file => {
	       const filePath = path.resolve(jsonFolder + file);
   	       let isDirectory = isDir(filePath);
               if(isDirectory === false) {
                   console.log("Reading: ", filePath);
		   const doc = fs.readFileSync(filePath, 'utf8');
		   const jData = JSON.parse(doc);
		   var id = '';
		   if(jData[0]) {
		        id = jData[0]["document_id"] ? jData[0]["document_id"] : jData["id"];
		   }
		   else {
			id = jData["id"];
		   }
		   // get the data in the form of a json document    
		   const jsonDocument = await getDataFromDoc(parser.id, id);
		   const data = jsonDocument[0].data;    
		   // partition the data into subsets of data
		   let pgCount = jsonDocument[0].page_count;
		   let divisor = (Number(data.length) / Number(pgCount)).toFixed(0);
		   var dataArr;
		   if(divisor > 1) {
		   // partition the unparsed data into equal parts
	               dataArr = splitParagraph(data[0].data, divisor);
		   }
	           else {
        	       dataArr = [data];
                   }
       	    	}
	   });
	});
        } catch (err) {
	    if(err) {
		console.log("Error on runMain()", err);
	    }
	    console.log("Retrying runMain() in 1 minute");	
	}
}

function resolveAfter1Min(m) {
	return new Promise((resolve) => {
		setTimeout(() => {
			resolve(m)
		}, 60000);	
	});
}

async function wait() {
	const msg = await resolveAfter1Min("Waiting for 1 minute ...");
	console.log(msg);
}

function waitSync(ms) {
	const start = Date.now();
	let now = start;
        while ( (now - start) < ms ) { now = Date.now(); }
}

runMain();
