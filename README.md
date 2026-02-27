have you ever wondered the exact font and kerning a website is using? 

font-inspector is a chrome extension to help satiate my typographic curiosity.

shoutout to claude opus 4.6 for writing this in 5 minutes.

## install locally

```bash
git clone https://github.com/arnavwadehra/font-inspector.git
cd font-inspector
npm install
npm run build
```

then in chrome:

1. go to `chrome://extensions`
2. enable **Developer mode** (top right toggle)
3. click **Load unpacked**
4. select the `dist/` folder created after running `npm run build`
