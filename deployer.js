const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");

const SECRET = process.env.AUTODY_DEPLOY_SECRET || "7a46ef64df74ee6551bcc647a9c205c7d93f57a0";
const DEPLOY_SCRIPT = process.env.AUTODY_DEPLOY_SCRIPT || "/var/www/autody-2.0/deploy.sh";

function verify(req, body) {
  const sig = String(req.headers["x-hub-signature-256"] || "");
  const hmac = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("hex");

  if (!sig) return false;
  return `sha256=${hmac}` === sig;
}

http.createServer((req, res) => {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    if (!verify(req, body)) {
      res.writeHead(401);
      return res.end("Invalid signature");
    }

    execFile(DEPLOY_SCRIPT, (err, stdout, stderr) => {
      if (err) {
        console.error(err);
        res.writeHead(500);
        return res.end("Deploy failed");
      }

      console.log(stdout);
      console.log(stderr);

      res.end("Deployed successfully");
    });
  });
}).listen(9000, () => {
  console.log("Webhook listening on port 9000");
});
