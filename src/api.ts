import { createServer } from "http";
import { getRaw, getProcessed, createPool } from "./db.js";


const API_PORT = parseInt(process.env.API_PORT ?? '', 10) || 3001
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'

async function main (){
  const pool = createPool()
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if(req.method == 'GET' && req.url == '/raw') {
      try{
        const row = await getRaw(pool);
        res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(row));
        return;
      } catch (err) {
        console.error(err);
        res.writeHead(500).end();
        return;
      }
    }

    if(req.method == 'GET' && req.url == '/processed'){
      try{
        const row = await getProcessed(pool);
        res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(row));
        return;
      } catch (err) {
        console.error(err);
        res.writeHead(500).end();
        return;
      }
    }

    res.writeHead(404).end();
  });

  server.listen(API_PORT, () => console.log(`listening on :${API_PORT}`))
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
