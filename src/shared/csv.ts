import fs from "fs";
import { parse } from "csv-parse";

export const readCSVFile = async <T>(filePath: string): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    fs.createReadStream(filePath)
      .pipe(
        parse({
          columns: true,
          delimiter: ",",
          skip_empty_lines: true,
        }),
      )
      .on("data", (row: T) => {
        records.push(row);
      })
      .on("end", () => {
        resolve(records);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
};
