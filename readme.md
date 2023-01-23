# Divi Performance Analyzer

## How To Run
1. Make sure your Node version is `>=16` LTS
2. Run `npm install`
3. Rename `.env.example` to `.env` and fill out variables accordingly
4. Checkout `temp-divi-performance-analyzer` in Divi `builder-5` repo and run `yarn start`.
4. Run `npm run start`

## FAQ

### Prerequisities on WSL2 Ubuntu 20.04:
`sudo apt-get install libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon-x11-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2`

### How to run headful Chrome with puppeteer on WSL2:
https://ohaleks.hashnode.dev/using-puppeteer-on-windows-with-wsl
https://stackoverflow.com/a/74606302