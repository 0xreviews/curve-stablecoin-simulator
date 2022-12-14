export function calc_tick(
	n: number,
	scale: number,
	PRICE_BASE: number
): number {
	return PRICE_BASE * scale ** n;
}

export function assert(condition: boolean, msg: string | undefined) {
	if (!condition) {
		if (msg) throw msg;
		throw "";
	}
}
