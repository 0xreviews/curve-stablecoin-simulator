import "mocha";
import chai from "chai";
import { Band, Controller, DetialedTrade, LLAMMA, User } from "../src";
import { random_in_range } from "./utils";

const { assert, expect } = chai;
const should = chai.should();
const FUZZY_COUNT = 500;

const A = 100;
const PRICE_BASE = 1000;
const FEE_RATE = 0.01; // 1%
const ADMIN_FEE_RATE = 0.0;
const LAON_DISCOUNT = 0.05;
const LIQUIDATION_DISCOUNT = 0.02;
const DEBT_CEILING = 10 ** 6;

describe("LLAMMA", () => {
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

	it(`amount_for_price.[FUZZY-${FUZZY_COUNT}]`, () => {
		for (let i = 0; i < FUZZY_COUNT; i++) {
			const { amm, controller, users } = setUp();
			let userAddr = users[0].addr;
			let [p_o, n1, dn, deposit_amount, init_trade_frac, p_frac] =
				generate_amount_for_price_params();
			amm.update_oracle(p_o);
			let n2 = n1 + dn;

			// Initial deposit
			amm.deposit_range(userAddr, deposit_amount, n1, n2);
			const eamount = deposit_amount * init_trade_frac * amm.get_p();
			if (eamount > 0) {
				amm.exchange(0, 1, eamount, 0);
			}
			let n0 = amm.active_band;

			let p_initial = amm.get_p();
			let p_final = p_initial * p_frac;
			let p_max = amm.get_tick_price(n2);
			let p_min = amm.get_tick_price(n1 + 1);

			let [amount, is_pump] = amm.get_amount_for_price(p_final);

			expect(
				is_pump === p_final >= p_initial,
				`pump should be ${p_final >= p_initial}`
			);

			if (is_pump) {
				amm.exchange(0, 1, amount, 0);
			} else {
				amm.exchange(1, 0, amount, 0);
			}

			let p = amm.get_p();
			let prec = 1e-6;
			if (amount > 0) {
				if (is_pump) {
					prec = Math.max(
						2 / amount + 2 / ((1e12 * amount) / p_max),
						prec
					);
				} else {
					prec = Math.max(
						2 / amount + 2 / ((amount * p_max) / 1e12),
						prec
					);
				}
			} else {
				continue; // pass
			}

			let n_final = amm.active_band;

			assert.approximately(p_max, amm.get_band(n2).p_o_up, 1e-8);
			assert.approximately(p_min, amm.get_band(n1).p_o_down, 1e-8);

			if (Math.abs(n_final - n0) < 50 - 1 && prec < 0.1) {
				if (
					p_final > p_min * (1 + prec) &&
					p_final < p_max * (1 - prec)
				) {
					assert.approximately(p, p_final, prec);
				} else if (p_final >= p_max * (1 - prec)) {
					if (Math.abs(p - p_max) > prec) {
						expect(n_final > n2);
					}
				} else if (p_final <= p_min * (1 + prec)) {
					if (Math.abs(p - p_min) > prec) {
						expect(n_final < n1);
					}
				}
			}
		}
	});

	it(`test_deposit_withdraw.[FUZZY-${FUZZY_COUNT}]`, () => {
		for (let i = 0; i < FUZZY_COUNT; i++) {
			const { amm, controller, users } = setUp();
			const params = generate_deposit_withdraw_params();
			let deposits: { [key: string]: number } = {};
			for (let i = 0; i < params.length; i++) {
				let { amount, n1, dn } = params[i];
				let n2 = n1 + dn;
				if (amount === 0) {
					should.Throw(() => {
						amm.deposit_range(users[i].addr, amount, n1, n2);
					}, "Amount too low");
				} else {
					amm.deposit_range(users[i].addr, amount, n1, n2);
					deposits[users[i].addr] = amount;
				}
			}

			for (let i = 0; i < params.length; i++) {
				let { amount, n1, dn } = params[i];
				const userAddr = users[i].addr;
				let user_sum = amm.get_xy_up(userAddr, true);
				if (userAddr in deposits) {
					if (n1 >= 0) {
						assert.approximately(
							user_sum,
							deposits[userAddr],
							1e-6
						);
					} else {
						expect(user_sum < deposits[userAddr]);
					}
				} else {
					expect(user_sum === 0);
				}
			}

			for (let i = 0; i < users.length; i++) {
				const userAddr = users[i].addr;
				if (userAddr in deposits) {
					amm.withdraw(userAddr);
					assert.approximately(
						amm.get_xy_up(userAddr, true),
						0,
						1e-6
					);
				} else {
					should.Throw(() => {
						amm.withdraw(userAddr);
					}, "No deposits");
				}
			}
		}
	});

	it(`test_dxdy_limits.[FUZZY-${FUZZY_COUNT}]`, () => {
		for (let i = 0; i < FUZZY_COUNT; i++) {
			const { amm, controller, users } = setUp();
			const params = generate_dxdy_limits_params();
			let amount_sum = 0;
			for (let i = 0; i < params.length; i++) {
				let { amount, n1, dn } = params[i];
				amount_sum += amount;
				let n2 = n1 + dn;
				amm.deposit_range(users[i].addr, amount, n1, n2);
			}

			// swap 0
			let out: DetialedTrade;
			out = amm.calc_swap_out(true, 0, amm.p_out);
			expect(out.in_amount === 0 && out.out_amount === 0);
			out = amm.calc_swap_out(false, 0, amm.p_out);
			expect(out.in_amount === 0 && out.out_amount === 0);

			// small swap
			out = amm.calc_swap_out(true, 1e-16, amm.p_out);
			expect(out.in_amount === 1e-16);
			assert.approximately(
				out.out_amount,
				out.in_amount / PRICE_BASE,
				4e-2 + (2 * amm.min_band) / amm.A,
				`${amm.min_band}`
			);

			// Huge swap
			out = amm.calc_swap_out(true, 1e12, amm.p_out);
			expect(out.in_amount < 1e12);
			expect(Math.abs(out.out_amount - amount_sum) <= 1000);

			out = amm.calc_swap_out(false, 1e12, amm.p_out);
			expect(out.in_amount === 0 && out.out_amount === 0);
		}
	});

	it(`test_exchange_down_up.[FUZZY-${FUZZY_COUNT}]`, () => {
		for (let i = 0; i < FUZZY_COUNT; i++) {
			const { amm, controller, users } = setUp();
			const params = generate_dxdy_limits_params();
			let amount_sum = 0;
			for (let i = 0; i < params.length; i++) {
				let { amount, n1, dn } = params[i];
				amount_sum += amount;
				let n2 = n1 + dn;
				amm.deposit_range(users[i].addr, amount, n1, n2);
			}

			let swap_amount = random_in_range(0, 1e9);
			let out = amm.calc_swap_out(true, swap_amount, amm.p_out);
			expect(out.in_amount <= swap_amount);
			let out2 = amm.calc_swap_out(true, out.in_amount, amm.p_out);
			expect(out.in_amount === out2.in_amount);
			assert.approximately(out.out_amount, out2.out_amount, 1e-6);

			amm.exchange(0, 1, out2.in_amount, 0);

			let sum_borrowed = 0;
			let sum_collateral = 0;
			for (let i = amm.min_band; i <= amm.max_band; i++) {
				const { x, y } = amm.get_band(i);
				sum_borrowed += x;
				sum_collateral += y;
			}
			expect(sum_borrowed === 0);
			assert.approximately(
				sum_collateral + out2.out_amount,
				amount_sum,
				1e-3
			);

			let in_amount = out2.out_amount / 0.99; // charge 1% twice
			let expected_out_amount = out2.in_amount;

			let out3 = amm.calc_swap_out(false, in_amount, amm.p_out);
			assert.approximately(out3.in_amount, in_amount, 5e-4);
			expect(Math.abs(out3.out_amount - expected_out_amount) <= 1);

			amm.exchange(1, 0, in_amount, 0);

			sum_borrowed = 0;
			sum_collateral = 0;
			for (let i = amm.min_band; i <= amm.max_band; i++) {
				const { x, y } = amm.get_band(i);
				sum_borrowed += x;
				sum_collateral += y;
			}
			assert.approximately(
				sum_borrowed + out3.out_amount,
				out2.in_amount,
				5e-4
			);
			assert.approximately(
				sum_collateral,
				amount_sum - out2.out_amount + out3.in_amount,
				5e-4
			);
		}
	});

	describe("Other functions works well.", () => {
		it("update_oracle", () => {
			const { amm, controller, users } = setUp();
			expect(amm.p_out === PRICE_BASE, "Should p_out init.");
			amm.update_oracle(1300);
			expect(amm.p_out === 1300, "Should update_oracle update p_out.");
		});

		it("get_tick_price", () => {
			const { amm, controller, users } = setUp();
			expect(
				amm.get_tick_price(0) === PRICE_BASE,
				"Should tick 0 price equals PRICE_BASE."
			);
			for (let i = -25; i < 25; i++) {
				const expectedRes = PRICE_BASE * ((A - 1) / A) ** i;
				assert.approximately(
					amm.get_tick_price(i),
					expectedRes,
					1e-6,
					`Should tick ${i} price equals ${expectedRes}.`
				);
			}
		});

		it("find_active_band", () => {
			const { amm, controller, users } = setUp();
			{
				const [n0, active_band] = amm.find_active_band();
				expect(n0 === 0, "active_band N should be 0 at begin.");
				expect(active_band === null, "active_band should be empty.");
			}
			amm.deposit_range(users[0].addr, 1, 1, 2);
			{
				const [n0, active_band] = amm.find_active_band();
				expect(
					n0 === 1,
					"active_band N should be 1 after deposit into band 1."
				);
				expect(
					(active_band as Band).y > 0,
					"active_band should have y after deposit."
				);
			}
		});
	});
});

function generate_deposit_withdraw_params(): { [key: string]: number }[] {
	let params: { [key: string]: number }[] = [];
	for (let i = 0; i < 5; i++) {
		params.push({
			amount: random_in_range(1e-18, 1e6),
			n1: Math.floor(random_in_range(-20, 20)),
			dn: Math.floor(random_in_range(0, 20)),
		});
	}
	return params;
}

function generate_dxdy_limits_params(): { [key: string]: number }[] {
	let params: { [key: string]: number }[] = [];
	for (let i = 0; i < 5; i++) {
		params.push({
			amount: random_in_range(1e-2, 1e6),
			n1: Math.floor(random_in_range(1, 20)),
			dn: Math.floor(random_in_range(0, 20)),
		});
	}
	return params;
}

function generate_amount_for_price_params(): number[] {
	let p_o = random_in_range(2000, 4000);
	let n1 = Math.floor(random_in_range(1, 50));
	let dn = Math.floor(random_in_range(0, 49));
	let deposit_amount = random_in_range(1e-6, 100); // colleteral amount
	let init_trade_frac = random_in_range(0, 1);
	let p_frac = random_in_range(1, 10);
	return [p_o, n1, dn, deposit_amount, init_trade_frac, p_frac];
}
