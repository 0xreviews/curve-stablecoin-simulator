import "mocha";
import chai from "chai";
import { Band } from "../src";
import { random_in_range } from "./utils";

const { assert, expect } = chai;
const should = chai.should();
const FUZZY_COUNT = 500;

const A = 100;
const A_COEFFICIENT = (A - 1) / A;
const PRICE_BASE = 1000;

describe("Band", () => {
	function setUp() {
		return new Band(A, PRICE_BASE, 0, 1000, 1);
	}

	describe("get_y0", () => {
		it("p_o should not zero", () => {
			const band = setUp();
			should.Throw(() => {
				band.get_y0(0);
			}, "p_o is zero");
		});

		it(`Should y0 correct.[Fuzzy-${FUZZY_COUNT}]`, () => {
			for (let i = 0; i < FUZZY_COUNT; i++) {
				let [p_o, N, x, y] = generate_band_params();
				let _band = new Band(A, PRICE_BASE, N, x, y);
				let y0 = _band.get_y0(p_o);
				test_y0_equation(y0, x, y, p_o, _band.p_o_up);
			}
		});
	});

	describe("get_formula", () => {
		it(`Should formula coeffients correct.[FUZZY-${FUZZY_COUNT}]`, () => {
			for (let i = 0; i < FUZZY_COUNT; i++) {
				let [p_o, N, x, y] = generate_band_params();
				let _band = new Band(A, PRICE_BASE, N, x, y);
				let { x0, y0, f, g, Inv } = _band.get_formula(p_o);
				// Inv = p_o A**2 y0**2
				assert.approximately(
					Inv / (p_o * A ** 2 * y0 ** 2),
					1,
					1e-2,
					`Inv = p_o A**2 y0**2 not equal`
				);
				// Inv = (x + f)(y + g)
				assert.approximately(
					Inv / ((x + f) * (y + g)),
					1,
					1e-2,
					"Inv = (x + f)(y + g) not equal"
				);
				// Inv = (x0 + f)(g)
				assert.approximately(
					Inv / ((x0 + f) * g),
					1,
					1e-2,
					"Inv = (x0 + f)(g) not equal"
				);

				// (f)(y0 + g) = (f + x0)(g)
				assert.approximately(
					(f * (y0 + g)) / ((x0 + f) * g),
					1,
					1e-2,
					`(f)(y0 + g) = (x0 + f)(g) not equal`
				);
				// Inv = (f)(y0 + g)
				assert.approximately(
					Inv / (f * (y0 + g)),
					1,
					1e-2,
					`Inv = (f)(y0 + g) not equal`
				);
			}
		});
	});

	describe("get_p", () => {
		it(`Should get_p correct.[FUZZY-${FUZZY_COUNT}]`, () => {
			for (let i = 0; i < FUZZY_COUNT; i++) {
				let [p_o, N, x, y] = generate_band_params();
				let _band = new Band(A, PRICE_BASE, N, x, y);
				let { x0, y0, f, g, Inv } = _band.get_formula(p_o);
				let p = _band.get_p(p_o);
				assert.approximately(
					p,
					(f + x) / (g + y),
					1e-3,
					"price = (f + x) / (g + y)"
				);
			}
		});
	});
});

function generate_band_params(): number[] {
	let y0 = random_in_range(0.1, 10);
	let N = Math.floor(random_in_range(-200, 200)); // MAX_TICKS = 50
	let p_o_up = PRICE_BASE * A_COEFFICIENT ** N;
	let p_o_down = PRICE_BASE * A_COEFFICIENT ** (N + 1);
	let p_o = random_in_range(p_o_up - 100, p_o_down + 100);
	// calculate y0 again because p_o is not p_o_up any more
	let newy0 = p_o * A * y0 / p_o_up;
	let Inv = p_o * A ** 2 * newy0 ** 2;
	let f = ((A * newy0 * p_o) / p_o_up) * p_o;
	let g = ((A - 1) * newy0 * p_o_up) / p_o;
	let x0 = 0 + newy0 * p_o_down; // whitepaper Formula 10.
	let y = random_in_range(0, y0);
	let x = Inv / (y + g) - f;
	return [p_o, N, x, y];
}

function test_y0_equation(
	y0: number,
	x: number,
	y: number,
	p_o: number,
	p_o_up: number
) {
	// whitepaper equation 6.
	let left =
		((p_o ** 2 * A * y0) / p_o_up + x) *
		((p_o_up * (A - 1) * y0) / p_o + y);
	let right = p_o * A ** 2 * y0 ** 2;
	assert.approximately(
		left / right,
		1,
		1e-3,
		`test_y0_equation: y0 not correct p_o ${p_o} y0 ${y0} y ${y} x ${x}`
	);
}
