import { Controller, LLAMMA, User } from "../src";

const A = 100;
const PRICE_BASE = 1000;
const FEE_RATE = 0.0;
const ADMIN_FEE_RATE = 0.0;
const LAON_DISCOUNT = 0.05;
const LIQUIDATION_DISCOUNT = 0.02;
const DEBT_CEILING = 10 ** 6;

function setUp() {
    let amm: LLAMMA;
    let controller: Controller;
    let users: User[];
    amm = new LLAMMA(
        A,
        FEE_RATE,
        ADMIN_FEE_RATE,
        LAON_DISCOUNT,
        LIQUIDATION_DISCOUNT,
        DEBT_CEILING,
        PRICE_BASE
    );
    controller = new Controller(LIQUIDATION_DISCOUNT, LAON_DISCOUNT, amm);
    users = [
        new User("user1", amm, controller),
        new User("user2", amm, controller),
        new User("user3", amm, controller),
        new User("user4", amm, controller),
        new User("user5", amm, controller),
    ];
    return { amm, controller, users };
}

const { amm, controller, users} = setUp();

amm.deposit_range(users[0].addr, 10, 0, 10);

console.log(amm.get_xy_up(users[0].addr, true))