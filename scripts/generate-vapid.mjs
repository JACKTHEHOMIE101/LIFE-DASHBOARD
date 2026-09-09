import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\nAdd these to your .env file:\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:you@example.com"\n`);
console.log(
  "Rotating these invalidates every existing push subscription, so devices\n" +
    "will need to re-enable notifications.\n",
);
