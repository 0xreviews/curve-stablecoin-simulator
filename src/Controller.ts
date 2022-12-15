import { LLAMMA } from "./LLAMMA";
import { DebtInfo, UserAddress } from "./types";
import { assert } from "./utils";

const MAX_TICKS_UINT = 50;
const MIN_TICKS = 5;
const MAX_TICKS = 50;
const MAX_RATE = 43959106799; // 400% APY

export class Controller {
	liquidation_discount: number;
	loan_discount: number;
	amm: LLAMMA;
	A: number;
	LOG_A_RATIO: number;
	SQRT_BAND_RATIO: number;
	total_debt: DebtInfo;
	loans: {
		[key: UserAddress]: DebtInfo;
	};
	liquidation_discounts: {
		[key: UserAddress]: number;
	};
	minted: number;
	redeemed: number;

	constructor(
		liquidation_discount: number,
		loan_discount: number,
		amm: LLAMMA
	) {
		this.liquidation_discount = liquidation_discount;
		this.loan_discount = loan_discount;
		this.amm = amm;

		// vars
		this.A = this.amm.A;
		this.LOG_A_RATIO = Math.log(this.A / (this.A - 1));
		this.SQRT_BAND_RATIO = Math.sqrt(this.A / (this.A - 1));
		this.total_debt = {
			init_debt: 0,
			rate_mul: 1,
		};
		this.loans = {};
		this.liquidation_discounts = {};

		this.minted = 0;
		this.redeemed = 0;
	}

	get_loan(user: UserAddress): DebtInfo {
		if (!this.loans[user]) {
			this.loans[user] = {
				init_debt: 0,
				rate_mul: 1,
			};
		}
		return this.loans[user];
	}

	set_loan(user: UserAddress, value: DebtInfo) {
		const { init_debt, rate_mul } = value;
		const user_loan = this.get_loan(user);
		if (typeof init_debt !== "undefined") user_loan.init_debt = init_debt;
		if (typeof rate_mul !== "undefined") user_loan.rate_mul = rate_mul;
	}

	get_y_effective(collateral: number, N: number, discount: number): number {
		// x_effective = sum_{i=0..N-1}(y / N * p(n_{n1+i})) =
		// = y / N * p_oracle_up(n1) * sqrt((A - 1) / A) * sum_{0..N-1}(((A-1) / A)**k)
		// === d_y_effective * p_oracle_up(n1) * sum(...) === y_effective * p_oracle_up(n1)
		// d_y_effective = y / N / sqrt(A / (A - 1))

		let d_y_effective =
			(collateral * (1 - discount)) / (this.SQRT_BAND_RATIO * N);
		let y_effective = d_y_effective;

		for (let i = 1; i < N; i++) {
			d_y_effective *= (this.A - 1) / this.A;
			y_effective += d_y_effective;
		}
		return y_effective;
	}

	calculate_debt_n1(collateral: number, debt: number, N: number): number {
		// Calculate the upper band number for the deposit to sit in
		// to support the given debt.
		assert(debt > 0, "No loan");

		let n0 = this.amm.active_band;
		let p_base = this.amm.get_tick_price(n0);

		let y_effective = this.get_y_effective(
			collateral,
			N,
			this.loan_discount
		);
		y_effective *= p_base / debt;

		assert(y_effective > 0, "Amount too low");
		let n1 = Math.log(y_effective);
		if (n1 < 0) {
			n1 -= this.LOG_A_RATIO;
		}
		n1 /= this.LOG_A_RATIO;

		n1 = Math.min(n1, 1024 - N) + n0;
		n1 = Math.floor(n1);
		if (n1 <= n0) {
			assert(this.amm.can_skip_bands(n1 - 1), "Debt too high");
		}
		assert(this.amm.get_tick_price(n1) < this.amm.p_out, "Debt too high");

		return n1;
	}

	create_loan(
		user: UserAddress,
		collateral: number,
		debt: number,
		N: number
	) {
		assert(this.get_loan(user).init_debt === 0, "Loan already created");
		assert(N > MIN_TICKS - 1, "Need more ticks");
		assert(N < MAX_TICKS + 1, "Need less ticks");

		let n1 = this.calculate_debt_n1(collateral, debt, N);
		let n2 = n1 + N - 1;

		// update rate_mul
		let rate_mul = this.total_debt.rate_mul;

		this.set_loan(user, { init_debt: debt, rate_mul });
		this.liquidation_discounts[user] = this.liquidation_discount;
		this.total_debt = {
			init_debt:
				(this.total_debt.init_debt * rate_mul) /
					this.total_debt.rate_mul +
				debt,
			rate_mul: rate_mul,
		};

		this.amm.deposit_range(user, collateral, n1, n2);

		this.minted += debt;
	}

	add_collateral_borrow(
		d_collateral: number,
		d_debt: number,
		user: UserAddress,
		remove_collateral: boolean
	): [number, number] {
		let debt = this.get_loan(user).init_debt;
		let rate_mul = this.get_loan(user).rate_mul;
		assert(debt > 0, "Loan doesn't exist");

		debt += d_debt;
		let { n1, n2 } = this.amm.get_user_shares(user) as {
			n1: number;
			n2: number;
		};
		let size = n2 - n1 + 1;
		let xy = this.amm.withdraw(user);
		assert(xy[0] === 0, "Already in underwater mode");

		if (remove_collateral) {
			xy[1] -= d_collateral;
		} else {
			xy[1] += d_collateral;
		}
		n1 = this.calculate_debt_n1(xy[1], debt, size);
		n2 = n1 + size - 1;

		this.amm.deposit_range(user, xy[1], n1, n2);
		this.set_loan(user, { init_debt: debt, rate_mul });
		this.liquidation_discounts[user] = this.liquidation_discount;

		if (d_debt !== 0) {
			this.total_debt = {
				init_debt:
					(this.total_debt.init_debt * rate_mul) /
						this.total_debt.rate_mul +
					d_debt,
				rate_mul: rate_mul,
			};
		}
		return [d_collateral, d_debt];
	}

	repay(user: UserAddress, d_debt: number): number {
		if (d_debt === 0) return 0;

		// Or repay all for MAX_UINT256
		// Withdraw if debt become 0

		let debt = this.get_loan(user).init_debt;
		let rate_mul = this.get_loan(user).rate_mul;
		assert(debt > 0, "Loan doesn't exist");
		d_debt = Math.min(debt, d_debt);
		debt -= d_debt;

		let { n1, n2 } = this.amm.get_user_shares(user) as {
			n1: number;
			n2: number;
		};
		let size = n2 - n1 + 1;
		let xy: [number, number];

		if (debt === 0) {
			// Allow to withdraw all assets even when underwater
			xy = this.amm.withdraw(user);
		} else {
			let active_band = this.amm.active_band;
			for (let i = 0; i < 1024; i++) {
				if (this.amm.get_band(active_band).x !== 0) break;
				active_band--;
			}

			if (n1 > active_band) {
				// Not in liquidation -can move bands
				xy = this.amm.withdraw(user);
				n1 = this.calculate_debt_n1(xy[1], debt, size);
				n2 = n1 + size - 1;
				this.amm.deposit_range(user, xy[1], n1, n2);
				this.liquidation_discounts[user] = this.liquidation_discount;
			} else {
				// pass
			}
		}

		this.redeemed += d_debt;

		this.set_loan(user, { init_debt: debt, rate_mul });
		this.total_debt = {
			init_debt:
				(this.total_debt.init_debt * rate_mul) /
				this.total_debt.rate_mul,
			rate_mul,
		};
		return d_debt;
	}

	remove_collateral(user: UserAddress, collateral: number): number {
		if (collateral === 0) return 0;
		const xy = this.add_collateral_borrow(collateral, 0, user, true);
		return xy[1];
	}
}
