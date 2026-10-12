/* ============================================================
   TF-IDF vectorizer.
   fit(docs)  → builds vocabulary + idf weights
   transform(text) → L2-normalized tf-idf vector aligned to vocab
   ============================================================ */
const { tokenize } = require('./tokenizer');

class TfidfVectorizer {
  constructor({ minDf = 2, maxVocab = 3000 } = {}) {
    this.minDf = minDf;
    this.maxVocab = maxVocab;
    this.vocab = [];
    this.vocabIndex = new Map();
    this.idf = [];
  }

  /** Fit on a corpus of raw documents. Returns this. */
  fit(docs) {
    const df = new Map();        // term → document frequency
    const tokenized = [];

    docs.forEach(doc => {
      const toks = tokenize(doc);
      tokenized.push(toks);
      new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1));
    });

    // Vocabulary: terms appearing in >= minDf docs, most frequent first
    const nDocs = docs.length;
    const terms = [...df.entries()]
      .filter(([, f]) => f >= this.minDf)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxVocab)
      .map(([t]) => t);

    this.vocab = terms;
    this.vocabIndex = new Map(terms.map((t, i) => [t, i]));
    // idf = log((1 + N) / (1 + df)) + 1  (smooth idf, scikit-learn style)
    this.idf = terms.map(t => {
      const f = df.get(t) || 0;
      return Math.log((1 + nDocs) / (1 + f)) + 1;
    });
    return this;
  }

  /** Transform a raw document into a dense L2-normalized tf-idf vector. */
  transform(text) {
    const vec = new Float64Array(this.vocab.length);
    const toks = tokenize(text);
    for (const t of toks) {
      const i = this.vocabIndex.get(t);
      if (i !== undefined) vec[i] += 1;
    }
    for (let i = 0; i < vec.length; i++) {
      if (vec[i] > 0) vec[i] *= this.idf[i];
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  /** Top-k terms in a document by tf-idf weight (for keyword extraction). */
  topTerms(text, k = 5) {
    const vec = this.transform(text);
    const idx = [...vec.keys()]
      .map(i => [i, vec[i]])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([i]) => this.vocab[i]);
    return idx;
  }

  toJSON() {
    return { vocab: this.vocab, idf: this.idf };
  }

  static fromJSON(data) {
    const v = new TfidfVectorizer();
    v.vocab = data.vocab || [];
    v.idf = data.idf || [];
    v.vocabIndex = new Map(v.vocab.map((t, i) => [t, i]));
    return v;
  }
}

module.exports = { TfidfVectorizer };