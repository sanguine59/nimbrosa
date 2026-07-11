import { createServer } from "http";
import { getRaw, getProcessed, createPool } from "./db.js";


async function main (){
  const pool = createPool()
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
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

  server.listen(3001, () => console.log('listening on localhost:3001'))
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
