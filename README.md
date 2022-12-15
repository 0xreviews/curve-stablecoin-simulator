# Curve Stable Coin JS

[curve-stablecoin](https://github.com/curvefi/curve-stablecoin) js implementation.

🖥️ [Graphic Live Demo](https://crvusd.0xreviews.xyz/)

## Install

```sh
npm i curve-stablecoin-js
```

## Getting Started

```ts
import { LLAMMA, Controller } from "curve-stablecoin-js";

const amm = new LLAMMA(100, 0.00, 0, 0.05, 0.02, 10 ** 6, 1000);
const controller = new Controller(0.02, 0.05, amm);

// deposit 10 ETH borrow 1000 crvUSD with 10 bands range
controller.create_loan("user1", 10, 1000, 10);

// swap in 100 crvUSD out ETH, min received 0.8ETH
// will return acctually out amount.
const out_amount = amm.exchange(0, 1, 1000, 0.8);
```

## Test

```sh
cd curve-stablecoin-js
npm install
npm test
```

## TODO

- PegKeeper
- mpoliceis
  - AggMonetaryPolicy
  - ConstantMonetaryPolicy
