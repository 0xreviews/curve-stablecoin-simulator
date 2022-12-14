export type FormulaResult = {
	x: number;
	y: number;
	x0: number;
	y0: number;
	f: number;
	g: number;
	Inv: number;
};

export type UserAddress = number | string;

export type TickShare = {
	[key: number]: number;
};

export type UserShare = {
	n1?: number;
	n2?: number;
	ticks?: TickShare;
};

export type PrintBandResult = {
	tick: number;
	price: number;
	x: number;
	y: number;
};

export type DebtInfo = {
	init_debt:number;
	rate_mul:number;
}