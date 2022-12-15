import { calc_tick, assert } from "./utils";
import type {
	FormulaResult,
	PrintBandResult,
	UserShare,
	UserAddress,
	TickShare,
} from "./types";
import { Band } from "./Band";

const MAX_TICKS = 50;
const MAX_TICKS_UINT = 50;
const MAX_SKIP_TICKS = 1024;

export class DetialedTrade {
	in_amount: number;
	out_amount: number;
	n1: number;
	n2: number;
	ticks_in: TickShare;
	last_tick_j: number;
	admin_fee: number;
	constructor({
		in_amount,
		out_amount,
		n1,
		n2,
		ticks_in,
		last_tick_j,
		admin_fee,
	}: {
		in_amount?: number;
		out_amount?: number;
		n1: number;
		n2: number;
		ticks_in?: TickShare;
		last_tick_j?: number;
		admin_fee?: number;
	}) {
		this.in_amount = in_amount || 0;
		this.out_amount = out_amount || 0;
		this.n1 = n1 || 0;
		this.n2 = n2 || 0;
		this.ticks_in = ticks_in || {};
		this.last_tick_j = last_tick_j || 0;
		this.admin_fee = admin_fee || 0;
	}
}

export class LLAMMA {
	A: number;
	A_COEFFICIENT: number;
	AminusOne: number;
	SQRT_BAND_RATIO: number;
	fee: number;
	admin_fee_rate: number;
	PRICE_BASE: number;
	admin_fees: { x: number; y: number };
	loan_discount: number;
	liquidation_discount: number;
	debt_ceiling: number;
	p_out: number;
	active_band: number;
	min_band: number;
	max_band: number;
	bands: { [key: number]: Band };
	total_shares: TickShare;
	user_shares: {
		[key: UserAddress]: UserShare;
	};
	rate_mul: number;

	constructor(
		A: number,
		fee: number,
		admin_fee_rate: number,
		loan_discount: number,
		liquidation_discount: number,
		debt_ceiling: number,
		PRICE_BASE: number
	) {
		// init params
		this.A = A;
		this.fee = fee;
		this.admin_fee_rate = admin_fee_rate;
		this.admin_fees = {
			x: 0,
			y: 0,
		};
		this.loan_discount = loan_discount;
		this.liquidation_discount = liquidation_discount;
		this.debt_ceiling = debt_ceiling;
		this.PRICE_BASE = PRICE_BASE;

		this.AminusOne = A - 1;
		this.A_COEFFICIENT = (A - 1) / A;
		this.SQRT_BAND_RATIO = Math.sqrt(A / (A - 1));

		// vars
		this.p_out = PRICE_BASE;
		this.active_band = 0;
		this.min_band = 0;
		this.max_band = 0;
		// bands: { N: Band }
		this.bands = {};
		// total_shares: { N: shares }
		this.total_shares = {};
		// user_shares: { address: {
		//      n1: N, // lower
		//      n2: N, // upper
		//      ticks: {
		//         N: tick_share,
		//         ...
		//      }
		// }}
		this.user_shares = {};
		this.rate_mul = 1;
	}

	update_oracle(p: number) {
		this.p_out = p;
	}

	get_tick_price(n: number) {
		return calc_tick(n, this.A_COEFFICIENT, this.PRICE_BASE);
	}

	print_bands(): PrintBandResult[] {
		return Object.keys(this.bands)
			.sort()
			.map((tick) => {
				let t = parseInt(tick);
				const { x, y } = this.get_band(t);
				return {
					tick: t,
					price: this.get_tick_price(t),
					x,
					y,
				};
			});
	}

	find_active_band(): [number, Band | null] {
		let n0 = this.active_band;
		const bands = this.print_bands();
		let active_band: Band | null = null;
		for (let i = 0; i < bands.length; i++) {
			active_band = this.get_band(n0);
			if (active_band.x !== 0 || active_band.y !== 0) break;
			n0++;
		}
		return [n0, active_band];
	}

	get_band(n: number): Band {
		if (this.bands[n]) return this.bands[n];
		return new Band(this.A, this.PRICE_BASE, n, 0, 0);
	}

	set_band(n: number, value: { x?: number; y?: number }) {
		const { x, y } = value;
		if (!this.bands[n])
			this.bands[n] = new Band(this.A, this.PRICE_BASE, n, 0, 0);
		let band = this.bands[n];
		if (typeof x !== "undefined") band.x = x;
		if (typeof y !== "undefined") band.y = y;
	}

	get_user_shares(user: UserAddress): UserShare {
		const _s = this.user_shares[user];
		if (_s)
			return {
				n1: _s.n1 || 0,
				n2: _s.n2 || 0,
				ticks: _s.ticks || {},
			};
		return {
			n1: 0,
			n2: 0,
			ticks: {},
		};
	}

	set_user_shares(
		user: UserAddress,
		value: {
			n1?: number;
			n2?: number;
			ticks_index?: number;
			ticks_value?: number;
		}
	) {
		const { n1, n2, ticks_index, ticks_value } = value;
		let _s = this.user_shares[user];
		if (_s) {
			if (typeof n1 !== "undefined") _s.n1 = n1;
			if (typeof n2 !== "undefined") _s.n2 = n2;
			if (
				typeof ticks_index !== "undefined" &&
				typeof ticks_value !== "undefined"
			) {
				if (!_s.ticks) _s.ticks = {};
				_s.ticks[ticks_index] = ticks_value;
			}
		} else {
			let o: UserShare = {};
			if (typeof n1 !== "undefined") o.n1 = n1;
			if (typeof n2 !== "undefined") o.n2 = n2;
			if (
				typeof ticks_index !== "undefined" &&
				typeof ticks_value !== "undefined"
			) {
				o.ticks = {};
				o.ticks[ticks_index] = ticks_value;
			}
			this.user_shares[user] = o;
		}
	}

	// can't deposit continuously
	// deposit -> withdraw -> deposit
	deposit_range(user: UserAddress, amount: number, n1: number, n2: number) {
		if (n1 > n2) {
			let tmp = n1;
			n1 = n2;
			n2 = tmp;
		}

		// Autoskip bands if we can
		let n0 = this.active_band;
		while (n0 >= this.min_band && n0 <= this.max_band) {
			if (n1 > n0) {
				this.active_band = n0;
				break;
			}
			assert(this.get_band(n0).x === 0, "Deposit below current band");
			n0 -= 1;
		}

		const n_bands = n2 - n1 + 1;
		let y = amount / n_bands;

		// Has liquidity
		let save_n = true;
		const _u: UserShare = this.get_user_shares(user);
		if (Object.keys(_u.ticks as TickShare).length > 0) {
			assert(n1 === _u.n1 && n2 === _u.n2, "Wrong range");
			save_n = false;
		}

		for (let i = n2; i > n1 - 1; i--) {
			assert(this.get_band(i).x === 0, "Band not empty");
			let total_y = this.get_band(i).y;
			// Total / user share
			let s = this.total_shares[i];
			if (s === 0 || typeof s === "undefined") {
				s = y;
				this.set_user_shares(user, {
					ticks_index: i,
					ticks_value: y,
				});
			} else {
				let ds = (s * y) / total_y;
				assert(ds > 0, "Amount too low");
				this.set_user_shares(user, {
					ticks_index: i,
					ticks_value: ds,
				});
				s += ds;
			}
			if (typeof this.bands[i] === "undefined") {
				this.set_band(i, { y });
			} else {
				this.set_band(i, { y: this.get_band(i).y + y });
			}
			this.total_shares[i] = s;
		}

		this.min_band = Math.min(this.min_band, n1);
		this.max_band = Math.max(this.max_band, n2);

		if (save_n) {
			this.set_user_shares(user, {
				n1,
				n2,
			});
		}

		// this.rate_mul;
	}

	withdraw(user: UserAddress): [number, number] {
		const { n1, n2, ticks } = this.get_user_shares(user) as {
			n1: number;
			n2: number;
			ticks: TickShare;
		};
		assert(
			typeof n1 !== "undefined" &&
				typeof n2 !== "undefined" &&
				typeof ticks !== "undefined" &&
				Object.keys(ticks).length > 0,
			"No deposits"
		);
		let total_x = 0;
		let total_y = 0;

		for (let i = n1; i < n2 + 1; i++) {
			let { x, y } = this.get_band(i);
			let ds = ticks[i];
			let s = this.total_shares[i];
			let dx = (x * ds) / s;
			let dy = (y * ds) / s;

			this.total_shares[i] = s - ds;
			x -= dx;
			y -= dy;
			// update min_band
			if (n1 === this.min_band && x === 0 && y === 0) {
				this.min_band += 1;
			}
			// update max_band
			if (x > 0 && y > 0) {
				this.max_band = Math.max(this.max_band, n2);
			}
			this.set_band(i, { x, y });
			total_x += dx;
			total_y += dy;
		}

		// empty user ticks
		this.user_shares[user].ticks = {};

		// rate_mul

		return [total_x, total_y];
	}

	exchange(
		i: number,
		j: number,
		in_amount: number,
		min_amount: number
	): number {
		const pump = i === 0;
		assert((pump && j === 1) || (!pump && j === 0), "Wrong index");
		if (in_amount === 0) return 0;

		let out = this.calc_swap_out(pump, in_amount, this.p_out);

		if (pump) {
			this.admin_fees.x += out.admin_fee;
		} else {
			this.admin_fees.y += out.admin_fee;
		}

		assert(out.out_amount >= min_amount, "Slippage");

		if (out.out_amount === 0) return 0;

		let n = out.n1;
		for (let k = 0; k < Math.abs(out.n2 - out.n1) + 1; k++) {
			if (pump) {
				this.set_band(n, { x: out.ticks_in[n] });
				if (n == out.n2) {
					this.set_band(n, { y: out.last_tick_j });
					break;
				}
				this.set_band(n, { y: 0 });
			} else {
				this.set_band(n, { y: out.ticks_in[n] });
				if (n == out.n2) {
					this.set_band(n, { x: out.last_tick_j });
					break;
				}
				this.set_band(n, { x: 0 });
			}
			if (out.n2 < out.n1) {
				n--;
			} else {
				n++;
			}
		}
		this.active_band = n;
		return out.out_amount;
	}

	calc_swap_out(
		pump: boolean,
		in_amount: number,
		p_o: number
	): DetialedTrade {
		// pump = True: borrowable (USD) in, collateral (ETH) out; going up
		// pump = False: collateral (ETH) in, borrowable (USD) out; going down
		const [n0] = this.find_active_band();
		let out = new DetialedTrade({ n1: n0, n2: n0 });
		let p_o_up = this.get_tick_price(out.n2);
		let { x, y } = this.get_band(out.n2);

		let in_amount_left = in_amount;
		const antifee = 1 / (1 - this.fee);

		let j = out.n2;
		while (j <= this.max_band && j >= this.min_band) {
			const band = new Band(this.A, this.PRICE_BASE, j, x, y);
			let { y0, f, g, Inv } = band.get_formula(p_o);

			if (pump) {
				if (y !== 0 && g !== 0) {
					let x_dest = Inv / g - f - x;
					let dx = x_dest * antifee;
					if (dx >= in_amount_left) {
						// this is the last band
						x_dest = in_amount_left / antifee;
						out.last_tick_j = Inv / (f + (x + x_dest)) - g;
						const admin_fees =
							(in_amount_left - x_dest) * this.admin_fee_rate;
						x += in_amount_left;
						// Round down the output
						out.out_amount += y - out.last_tick_j;
						out.ticks_in[j] = x - admin_fees;
						out.in_amount = in_amount;
						out.admin_fee += admin_fees;
						break;
					} else {
						// We go into the next band
						const admin_fees = (dx - x_dest) * this.admin_fee_rate;
						in_amount_left -= dx;
						out.ticks_in[j] = x + dx - admin_fees;
						out.in_amount += dx;
						out.out_amount += y;
						out.admin_fee += admin_fees;
					}
				}
				j += 1;
				p_o_up = p_o_up * this.A_COEFFICIENT;
				x = 0;
				y = this.get_band(j).y;
			} else {
				if (x !== 0 && f !== 0) {
					let y_dest = Inv / f - g - y;
					let dy = y_dest * antifee;
					if (dy >= in_amount_left) {
						// This is the last band
						y_dest = in_amount_left / antifee;
						out.last_tick_j = Inv / (g + (y + y_dest)) - f;
						const admin_fees =
							(in_amount_left - y_dest) * this.admin_fee_rate;
						y += in_amount_left;
						out.out_amount += x - out.last_tick_j;
						out.ticks_in[j] = y - admin_fees;
						out.in_amount = in_amount;
						out.admin_fee += admin_fees;
						break;
					} else {
						// We go into the next band
						const admin_fees = (dy - y_dest) * this.admin_fee_rate;
						in_amount_left -= dy;
						out.ticks_in[j] = y + dy - admin_fees;
						out.in_amount += dy;
						out.out_amount += x;
						out.admin_fee += admin_fees;
					}
				}
				j -= 1;
				p_o_up /= this.A_COEFFICIENT;
				x = this.get_band(j).x;
				y = 0;
			}
			out.n2 = j;
			if (out.n2 < this.min_band) {
				out.n2 = this.min_band;
				break;
			}
			if (out.n2 > this.max_band) {
				out.n2 = this.max_band;
				break;
			}
		}
		return out;
	}

	get_p(): number {
		let [n0, active_band] = this.find_active_band();
		if (!active_band) active_band = this.get_band(this.active_band);
		return active_band.get_p(this.p_out);
	}

	// @notice Amount necessary to be exchanged to have the AMM at the final price `p`
	// @return (amount, is_pump)
	get_amount_for_price(p: number): [number, boolean] {
		let [n0, active_band] = this.find_active_band();
		if (!active_band) return [0, true];

		let amount = 0;
		let pump = p >= this.get_p();

		for (let i = this.min_band; i <= this.max_band; i++) {
			const band = this.get_band(n0);
			assert(band?.p_o_up > 0, "p_o_up is zero");

			let { x, y, y0, f, g, Inv } = band.get_formula(this.p_out);

			// p in band, last loop
			if (p <= band.p_o_up && p >= band.p_o_down) {
				if (x > 0 || y > 0) {
					let ynew = Math.max(Math.sqrt(Inv / p), g) - g;
					let xnew = Math.max(Inv / (g + ynew), f) - f;
					if (pump) {
						amount += Math.max(xnew, x) - x;
					} else {
						amount += Math.max(ynew, y) - y;
					}
					break;
				}
			}

			if (pump) {
				if (x > 0 || y > 0) {
					amount += Inv / g - f - x;
				}
				if (n0 === this.max_band) break;

				n0++;
			} else {
				if (x > 0 || y > 0) {
					amount += Inv / f - g - y;
				}
				if (n0 === this.min_band) break;

				n0--;
			}
		}

		amount *= 1 / (1 - this.fee);
		return [amount, pump];
	}

	get_xy_up(user: UserAddress, use_y: boolean): number {
		let { n1, n2, ticks } = this.user_shares[user];
		if (
			typeof n1 === "undefined" ||
			typeof n2 === "undefined" ||
			typeof ticks === "undefined" ||
			Object.keys(ticks as object).length === 0
		)
			return 0;

		assert(this.p_out !== 0, "p_o is zero");

		let XY = 0;

		for (let i = n1; i <= n2; i++) {
			let x = 0;
			let y = 0;

			const band = this.get_band(i);
			let { p_o_up, p_o_down } = band;
			if (i >= this.active_band) {
				y = band.y;
			}
			if (i <= this.active_band) {
				x = band.x;
			}

			if (x === 0 && y === 0) continue;
			if (this.total_shares[i] === 0 || ticks[i] === 0) continue;

			const share = ticks[i] / this.total_shares[i];

			let p_current_mid =
				(this.p_out ** 3 / p_o_down ** 2) * this.A_COEFFICIENT;

			// if p_o > p_o_up - we "trade" everything to y and then convert to the result
			// if p_o < p_o_down - "trade" to x, then convert to result
			// otherwise we are in-band, so we do the more complex logic to trade
			// to p_o rather than to the edge of the band
			// trade to the edge of the band == getting to the band edge while p_o=const

			// Cases when special conversion is not needed (to save on computations)
			if (x === 0 || y === 0) {
				if (this.p_out > p_o_up) {
					// p_o < p_current_down
					// all to y at constant p_o, then to target currency adiabatically
					let y_equiv = y;
					if (y === 0) {
						y_equiv = x / p_current_mid;
					}
					if (use_y) {
						XY += y_equiv * share;
					} else {
						XY +=
							((y_equiv * p_o_up) / this.SQRT_BAND_RATIO) * share;
					}
					continue;
				} else if (this.p_out < p_o_down) {
					// all to x at constant p_o, then to target currency adiabatically
					let x_equive = x;
					if (x === 0) {
						x_equive = y * p_current_mid;
					}
					if (use_y) {
						XY +=
							((x_equive * this.SQRT_BAND_RATIO) / p_o_up) *
							share;
					} else {
						XY += x_equive * share;
					}
					continue;
				}
			}

			// If we are here - we need to "trade" to somewhere mid-band
			// So we need more heavy math

			let { y0, f, g, Inv } = band.get_formula(this.p_out);

			// p = (f + x) / (g + y) => p * (g + y)**2 = I or (f + x)**2 / p = I

			// First, "trade" in this band to p_oracle
			let x_o = 0;
			let y_o = 0;

			// p_o < p_current_down, all to y
			if (this.p_out > p_o_up) {
				// x_o = 0
				y_o = Math.max(Inv / f, g) - g;
				if (use_y) {
					XY += y_o * share;
				} else {
					XY += ((y_o * p_o_up) / this.SQRT_BAND_RATIO) * share;
				}
			} else if (this.p_out < p_o_down) {
				// p_o > p_current_up, all to x
				// y_o = 0
				x_o = Math.max(Inv / g, f) - f;
				if (use_y) {
					XY += ((x_o * this.SQRT_BAND_RATIO) / p_o_up) * share;
				} else {
					XY += x_o * share;
				}
			} else {
				y_o = Math.max(Math.sqrt(Inv / this.p_out), g) - g;
				x_o = Math.max(Inv / (g + y_o), f) - f;

				// Now adiabatic conversion from definitely in-band
				if (use_y) {
					XY += (y_o + x_o / Math.sqrt(p_o_up * this.p_out)) * share;
				} else {
					XY +=
						(x_o + y_o * Math.sqrt(p_o_down * this.p_out)) * share;
				}
			}
		}

		return XY;
	}

	can_skip_bands(n_end: number): boolean {
		// Check that we have no liquidity between active_band and `n_end`
		// Actually skipping bands:
		// * change self.active_band to the new n
		// * change self.p_base_mul
		// to do n2-n1 times (if n2 > n1):
		// out.base_mul = unsafe_div(out.base_mul * Aminus1, A)
		let n = this.active_band;
		for (let i = 0; i < MAX_SKIP_TICKS; i++) {
			if (n_end > n) {
				if (this.get_band(n).y !== 0) return false;
				n += 1;
			} else {
				if (this.get_band(n).x !== 0) return false;
				n -= 1;
			}
			if (n === n_end) break;
		}
		return true;
	}
}
