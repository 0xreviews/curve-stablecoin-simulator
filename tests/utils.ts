export function random_in_range(min: number, max: number): number {
	return min + (max - min) * Math.random();
}