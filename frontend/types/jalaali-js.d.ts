declare module "jalaali-js" {
  export function isValidJalaaliDate(year: number, month: number, day: number): boolean;

  export function toGregorian(
    year: number,
    month: number,
    day: number,
  ): { gy: number; gm: number; gd: number };

  export function toJalaali(
    year: number,
    month: number,
    day: number,
  ): { jy: number; jm: number; jd: number };
}
