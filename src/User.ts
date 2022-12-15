import { Controller } from "./Controller";
import { LLAMMA } from "./LLAMMA";
import { UserAddress } from "./types";

export class User {
	addr: UserAddress;
	amm: LLAMMA;
	controller: Controller;
	debt: number;
	colleteral: number;

	constructor(addr: UserAddress, amm: LLAMMA, controller: Controller) {
		this.addr = addr;
		this.amm = amm;
		this.controller = controller;
		this.debt = 0;
		this.colleteral = 10;
	}

	create_loan(colleteral: number, debt: number, N: number) {
		colleteral = Math.min(colleteral, this.colleteral);
		this.controller.create_loan(this.addr, colleteral, debt, N);
		this.colleteral -= colleteral;
		this.debt += debt;
	}

	exchange(i: number, j: number, in_amount: number): number {
		let out_amount: number;
		if (i === 0) {
			// in_amount = Math.min(in_amount, this.debt);
			out_amount = this.amm.exchange(i, j, in_amount, 0);
			this.colleteral += out_amount;
			this.debt -= in_amount;
		} else {
			// in_amount = Math.min(in_amount, this.colleteral);
			out_amount = this.amm.exchange(i, j, in_amount, 0);
			this.debt += out_amount;
			this.colleteral -= in_amount;
		}
		return out_amount;
	}

	repay() {
		this.colleteral += this.controller.repay(this.addr, this.debt);
		this.debt = 0;
	}

	remove_collateral() {
		const { ticks } = this.amm.get_user_shares(this.addr);
		let collateral = 0;
		for (let i in ticks) {
			let t = parseInt(i);
			const y = this.amm.get_band(t).y;
			collateral += (y * ticks[t]) / this.amm.total_shares[t];
		}
		this.colleteral -= this.controller.remove_collateral(
			this.addr,
			collateral
		);
	}
}
