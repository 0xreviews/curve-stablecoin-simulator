import { FormulaResult } from "./types";
import { assert, calc_tick } from "./utils";

export class Band {
	A: number;
	A_COEFFICIENT: number;
	PRICE_BASE: number;
	N: number;
	x: number;
	y: number;
	p_o_up: number;
	p_o_down: number;

	constructor(
		A: number,
		PRICE_BASE: number,
		N: number,
		x: number,
		y: number
	) {
		this.A = A;
		this.A_COEFFICIENT = (A - 1) / A;
		this.PRICE_BASE = PRICE_BASE;
		this.N = N;
		this.x = x;
		this.y = y;
		this.p_o_up = calc_tick(N, this.A_COEFFICIENT, PRICE_BASE);
		this.p_o_down = calc_tick(N + 1, this.A_COEFFICIENT, PRICE_BASE);
	}

	get_y0(p_o: number): number {
		assert(p_o !== 0, "p_o is zero");
		// solve:
		// p_o * A * y0**2 - y0 * (p_oracle_up/p_o * (A-1) * x + p_o**2/p_oracle_up * A * y) - xy = 0
		// p_o_up * (A - 1) * x / p_o + A * p_o**2 / p_o_up * y
		let b = 0;
		if (this.x !== 0) {
			b = this.p_o_up * (this.A - 1) * this.x / p_o;
		}
		if (this.y !== 0) {
			b += this.A * p_o**2 / this.p_o_up * this.y;
		}
		if (this.x > 0 && this.y > 0) {
			let D = b ** 2 + 4 * this.A * p_o * this.y * this.x;
			return (b + Math.sqrt(D)) / (2 * this.A * p_o);
		} else {
			return b / (this.A * p_o);
		}
	}

	get_formula(p_o: number): FormulaResult {
		let y0 = this.get_y0(p_o);
		let f = this.A * y0 * p_o / this.p_o_up * p_o;
		let g = ((this.A - 1) * y0 * this.p_o_up) / p_o;
		let Inv = (f + this.x) * (g + this.y);
		let x0 = this.x + this.y * Math.sqrt(this.p_o_down * p_o); // whitepaper formula 10.

		return { x: this.x, y: this.y, x0, y0, f, g, Inv };
	}

	get_p(p_o: number): number {
		// Special cases
		if (this.x === 0) {
			if (this.y === 0) {
				// return mid-band
				return ((p_o ** 3 / this.p_o_up ** 2) * this.A) / (this.A - 1);
			}
			// if x == 0: # Lowest point of this band -> p_current_down
			return p_o ** 3 / this.p_o_up ** 2;
		}
		if (this.y === 0) {
			// Highest point of this band -> p_current_up
			return p_o ** 3 / this.p_o_down ** 2;
		}

		// (f(y0) + x) / (g(y0) + y)
		let { f, g } = this.get_formula(p_o);
		return (f + this.x) / (g + this.y);
	}
}
