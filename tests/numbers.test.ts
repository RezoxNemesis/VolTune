import { describe, expect, it } from "vitest";
import { expandNumbers, numberToWords, ordinalToWords, yearToWords } from "../src/engine/numbers";
import { normalize } from "../src/engine/text";

describe("numberToWords", () => {
  it.each([
    [0, "zero"],
    [7, "seven"],
    [13, "thirteen"],
    [21, "twenty-one"],
    [100, "one hundred"],
    [342, "three hundred forty-two"],
    [1001, "one thousand one"],
    [12_345, "twelve thousand three hundred forty-five"],
    [1_000_000, "one million"],
    [-5, "minus five"],
  ])("%s -> %s", (n, w) => expect(numberToWords(n)).toBe(w));
});

describe("ordinals and years", () => {
  it.each([
    [1, "first"],
    [2, "second"],
    [3, "third"],
    [5, "fifth"],
    [12, "twelfth"],
    [20, "twentieth"],
    [21, "twenty-first"],
    [100, "one hundredth"],
    [103, "one hundred third"],
  ])("ordinal %s -> %s", (n, w) => expect(ordinalToWords(n)).toBe(w));

  it.each([
    [1995, "nineteen ninety-five"],
    [2026, "twenty twenty-six"],
    [2005, "two thousand five"],
    [2000, "two thousand"],
    [1900, "nineteen hundred"],
    [1905, "nineteen oh five"],
  ])("year %s -> %s", (y, w) => expect(yearToWords(y)).toBe(w));
});

describe("expandNumbers", () => {
  it("reads currency", () => {
    expect(expandNumbers("It costs $5.50 today.")).toBe("It costs five dollars and fifty cents today.");
    expect(expandNumbers("Pay £1 now")).toBe("Pay one pound now");
    expect(expandNumbers("Worth $1,200.")).toBe("Worth one thousand two hundred dollars.");
  });
  it("reads times", () => {
    expect(expandNumbers("Meet at 10:30 sharp")).toBe("Meet at ten thirty sharp");
    expect(expandNumbers("At 9:05 pm")).toBe("At nine oh five p m");
    expect(expandNumbers("Be there at 3pm")).toBe("Be there at three p m");
  });
  it("reads ordinals, dates and years", () => {
    expect(expandNumbers("On March 5, 2024 we met")).toBe("On March fifth, twenty twenty-four we met");
    expect(expandNumbers("the 21st century")).toBe("the twenty-first century");
    expect(expandNumbers("born in 1987")).toBe("born in nineteen eighty-seven");
  });
  it("reads decimals, separators and ranges", () => {
    expect(expandNumbers("pi is 3.14")).toBe("pi is three point one four");
    expect(expandNumbers("1,500 people")).toBe("one thousand five hundred people");
    expect(expandNumbers("pages 10-20")).toBe("pages ten to twenty");
  });
  it("leaves text without digits untouched", () => {
    expect(expandNumbers("No numbers here.")).toBe("No numbers here.");
  });
});

describe("normalize with numbers and acronyms", () => {
  it("expands percent after numbers", () => {
    expect(normalize("Up 50% since 2019.")).toBe("Up fifty percent since twenty nineteen.");
  });
  it("spells common initialisms and fixes OK", () => {
    expect(normalize("The CEO said AI is OK.")).toBe("The C E O said A I is okay.");
  });
  it("does not spell ordinary words", () => {
    expect(normalize("We like it and us.")).toBe("We like it and us.");
  });
});
