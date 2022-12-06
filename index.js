import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
import path from 'path';
const __dirname = path.dirname('.');
console.log("Working Directory: ", __dirname)
const env = process.config({path: path.resolve('.env')});
console.log(env);

const apiKey = env.parsed.APIKEY
console.log("Using API Key: ", apiKey);
const client = new docParser.Client(apiKey); // api key
const fsFolder = env.parsed.FSVOBFOLDER;
console.log("@Subdirectory: ", fsFolder);
const parserId = env.parsed.VOBPARSERID
const jsonFolder = fsFolder + 'json/';

//const apiKey = "810fa30e4ff6186e3b886f0c7f37411dbd85a778";
//const client = new docParser.Client("810fa30e4ff6186e3b886f0c7f37411dbd85a778"); // api key
//const fsFolder = 'fs/vobs/' // path of vob files
//const parserId = 'shodskezdfwg'; // for parsing vobs

client.ping().then(function(){
    console.log('Connection established');
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
    })
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

async function recGetResultsByDocument(parserId, docId, file, jFolder) {
    await client.getResultsByDocument(parserId, docId, {format: 'object'})
    .then(function (res) {
        console.log(res);
        const json = JSON.stringify(res);
        fs.writeFile(jFolder + file + '.' +parserId + '.json', json)
        .then(function() {
            // upload json documents to mongdb from here
        });
    })
    .catch(function (err) {
        console.log(err);
    });
}

await fs.readdir(fsFolder, (err, files) => {
    files.forEach(file => {
        const filePath = path.resolve(fsFolder + file);
        let isDirectory = isDir(filePath);
        if(isDirectory === false) {
	    if(file.search("VOB") !== -1) {
            console.log("Reading: ", filePath);
            console.log('Uploading file: ' + filePath + " to Parser: " + parser.id);
            //const guid = file.split(".", pattern);
            client.uploadFileByPath(parser.id, filePath).then(function (result) {
                console.log(result);
                console.log("Processing: ", result.id);
                const json = JSON.stringify({ id: result.id });
                console.log("Saving to json document to: ", jsonFolder);
                const jsonPath = path.resolve(jsonFolder + result.id + ".json");
                fs.writeFile(jsonPath, json, (err) => {
                    if (err) throw err;
                        console.log('The file has been saved!');
                });
            })
                //recGetResultsByDocument(parser.id, result.id, file, jsonFolder);
                // client.getResultsByDocument(parser.id, result.id, {format: 'object'})
                // .then(function (res) {
                //     console.log(res);
                //     const json = JSON.stringify(res);
                //     fs.writeFile(jsonFolder+file + '.' +parser.id + '.json', json)
                //     .then(function() {
                //         // upload json documents to mongdb from here
                //     });
                // })
                // .catch(function (err) {
                //     console.log(err)
                // });
            .catch(function (err) {
                console.log(err)
            });
	  }
        }
    });
});

