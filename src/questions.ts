export type Question = {
  cat: string;
  word: string;
  options: string[];
  answer: string;
  tip: string;
};

export const Q: Question[] = [
  { cat: "S ou Z", word: "CA__A", options: ["S", "Z"], answer: "S", tip: "Casa se escreve com S." },
  { cat: "S ou Z", word: "A__UL", options: ["S", "Z"], answer: "Z", tip: "Azul se escreve com Z." },
  { cat: "G ou J", word: "__IRASSOL", options: ["G", "J"], answer: "G", tip: "Girassol tem som de GI, com G." },
  { cat: "G ou J", word: "HO__E", options: ["G", "J"], answer: "J", tip: "Hoje se escreve com J." },
  { cat: "X ou CH", word: "__UVA", options: ["X", "CH"], answer: "CH", tip: "Chuva se escreve com CH." },
  { cat: "X ou CH", word: "PEI__E", options: ["X", "CH"], answer: "X", tip: "Peixe se escreve com X." },
  { cat: "R ou RR", word: "CA__O", options: ["R", "RR"], answer: "RR", tip: "Carro tem som forte entre vogais, por isso RR." },
  { cat: "R ou RR", word: "CA__INHO", options: ["R", "RR"], answer: "R", tip: "Carinho tem som fraco, por isso R." },
  { cat: "M ou N", word: "CA__PO", options: ["M", "N"], answer: "M", tip: "Antes de P e B usamos M: campo." },
  { cat: "M ou N", word: "CA__TO", options: ["M", "N"], answer: "N", tip: "Canto se escreve com N." },
  { cat: "C ou SS", word: "PA__ARO", options: ["C", "SS"], answer: "SS", tip: "Passaro se escreve com SS: passaro/passaro no jogo sem acento." },
  { cat: "C ou CEDILHA", word: "CORA__AO", options: ["C", "\u00c7"], answer: "\u00c7", tip: "Coracao leva cedilha antes de A, O ou U." },
  { cat: "L ou U", word: "FINA__", options: ["L", "U"], answer: "L", tip: "Final termina com L." },
  { cat: "L ou U", word: "CE__", options: ["L", "U"], answer: "U", tip: "Ceu termina com U." },
  { cat: "E ou I", word: "M__NINO", options: ["E", "I"], answer: "E", tip: "Menino se escreve com E na primeira silaba." },
  { cat: "E ou I", word: "P__PINO", options: ["E", "I"], answer: "E", tip: "Pepino se escreve com E." },
  { cat: "O ou U", word: "B__NITO", options: ["O", "U"], answer: "O", tip: "Bonito se escreve com O." },
  { cat: "O ou U", word: "C__RUJA", options: ["O", "U"], answer: "O", tip: "Coruja se escreve com O." },
  { cat: "H inicial", word: "__OMEM", options: ["H", "O"], answer: "H", tip: "Homem tem H inicial." },
  { cat: "H inicial", word: "__ORTA", options: ["H", "O"], answer: "H", tip: "Horta tem H inicial." },
  { cat: "QU ou C", word: "__ENTE", options: ["QU", "C"], answer: "QU", tip: "Quente se escreve com QU." },
  { cat: "QU ou C", word: "__ASA", options: ["QU", "C"], answer: "C", tip: "Casa se escreve com C no inicio." },
  { cat: "GU ou G", word: "__ITARRA", options: ["GU", "G"], answer: "GU", tip: "Guitarra se escreve com GU." },
  { cat: "GU ou G", word: "__ATO", options: ["GU", "G"], answer: "G", tip: "Gato se escreve com G." }
];
