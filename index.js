import docParser from 'docparser-node';
import fs from 'fs';
import process from 'dotenv'
process.config({path: '.env'});

//const apiKey = process.env.APIKEY
//const fsVobFolder = process.env.FSVOBFOLDER
//const vobParserId = process.env.VOBPARSERID
//const jsonVobFolder = process.env.JSONVOBFOLDER

const client = new docParser.Client("810fa30e4ff6186e3b886f0c7f37411dbd85a778"); // api key
const fsFolder = 'fs/vobs/' // path of vob files
const jsonVobFolder = fsFolder + 'json/';
const parserId = 'shodskezdfwg'; // for parsing vobs

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

// client.uploadFileByPath('PARSER_ID', './test.pdf', {remote_id: guid})
// const pattern = new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'i');

fs.readdir(fsFolder, (err, files) => {
    files.forEach(file => {
        console.log(file);
        console.log('Uploading file: ' + file + " to Parser: " + parser.id);
        //const guid = file.split(".", pattern);
        client.uploadFileByPath(parser.id, fsFolder + file).then(function (result) {
            console.log(result);
            client.getResultsByDocument(parser.id, result.id, {format: 'object'})
            .then(function (res) {
                console.log(res);
                const json = JSON.stringify(res);
                fs.writeFile(jsonVobFolder+file + '.' +parser.id + '.json', json)
                .then(function() {
                    // upload json documents to mongdb from here
                });
            })
            .catch(function (err) {
                console.log(err)
            })
        })
        .catch(function (err) {
            console.log(err)
        });
    });
});
