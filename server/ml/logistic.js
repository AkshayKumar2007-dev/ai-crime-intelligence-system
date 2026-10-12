/* ============================================================
   Multiclass logistic regression (softmax) with L2 regularization,
   trained via batch gradient descent with momentum.
   ============================================================ */

class SoftmaxRegression {
  constructor({ nClasses = 0, nFeatures = 0, lr = 0.5, epochs = 150, l2 = 0.01, momentum = 0.9, temperature = 1.0 } = {}) {
    this.nClasses = nClasses;
    this.nFeatures = nFeatures;
    this.lr = lr;
    this.epochs = epochs;
    this.l2 = l2;
    this.momentum = momentum;
    // Temperature scaling at prediction time (argmax invariant, sharper probs).
    this.temperature = temperature;
    // weights[c][f], intercepts[c]
    this.W = [];
    this.b = [];
  }

  /** Initialize weights with small random values (Xavier-ish). */
  initParams() {
    const scale = Math.sqrt(2 / (this.nFeatures + this.nClasses));
    this.W = Array.from({ length: this.nClasses }, () =>
      Array.from({ length: this.nFeatures }, () => (Math.random() * 2 - 1) * scale)
    );
    this.b = new Array(this.nClasses).fill(0);
  }

  /** X: [n, features] Float64Array rows; y: int labels. */
  fit(X, y) {
    const n = X.length;
    this.initParams();

    // One-hot targets
    const Y = Array.from({ length: n }, () => new Float64Array(this.nClasses));
    for (let i = 0; i < n; i++) Y[i][y[i]] = 1;

    // Momentum buffers
    let vW = this.W.map(r => new Float64Array(r.length));
    let vb = new Float64Array(this.nClasses);

    for (let epoch = 0; epoch < this.epochs; epoch++) {
      // Decaying learning rate
      const lr = this.lr / (1 + 0.01 * epoch);

      // Softmax scores: P = softmax(W·X + b) — always at temperature 1 during training
      const P = X.map(x => this.predictProbaRow(x, 1));

      // Gradients
      const gradW = this.W.map(() => new Float64Array(this.nFeatures));
      const gradB = new Float64Array(this.nClasses);

      for (let i = 0; i < n; i++) {
        for (let c = 0; c < this.nClasses; c++) {
          const err = P[i][c] - Y[i][c]; // (p - y)
          gradB[c] += err;
          const x = X[i];
          const gw = gradW[c];
          for (let f = 0; f < this.nFeatures; f++) gw[f] += err * x[f];
        }
      }

      // Average + L2 regularization (excluding bias)
      for (let c = 0; c < this.nClasses; c++) {
        const gw = gradW[c];
        for (let f = 0; f < this.nFeatures; f++) {
          gw[f] = gw[f] / n + this.l2 * this.W[c][f];
          vW[c][f] = this.momentum * vW[c][f] + lr * gw[f];
          this.W[c][f] -= vW[c][f];
        }
        gradB[c] = gradB[c] / n;
        vb[c] = this.momentum * vb[c] + lr * gradB[c];
        this.b[c] -= vb[c];
      }
    }
    return this;
  }

  /** Softmax probabilities for a single feature vector. */
  predictProbaRow(x, temperature = this.temperature) {
    const scores = new Float64Array(this.nClasses);
    let max = -Infinity;
    for (let c = 0; c < this.nClasses; c++) {
      let s = this.b[c];
      const w = this.W[c];
      for (let f = 0; f < this.nFeatures; f++) s += w[f] * x[f];
      scores[c] = s;
      if (s > max) max = s;
    }
    // Numerically stable softmax with optional temperature scaling
    let sum = 0;
    for (let c = 0; c < this.nClasses; c++) {
      scores[c] = Math.exp((scores[c] - max) / temperature);
      sum += scores[c];
    }
    for (let c = 0; c < this.nClasses; c++) scores[c] /= sum;
    return scores;
  }

  /** X: single vector or array of vectors → array of probability arrays. */
  predictProba(X) {
    if (X.length && typeof X[0] === 'number') return [this.predictProbaRow(X)];
    return X.map(x => this.predictProbaRow(x));
  }

  /** Argmax prediction(s). */
  predict(X) {
    const proba = this.predictProba(X);
    return proba.map(p => {
      let best = 0;
      for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
      return best;
    });
  }

  accuracy(X, y) {
    const preds = this.predict(X);
    let correct = 0;
    for (let i = 0; i < y.length; i++) if (preds[i] === y[i]) correct++;
    return correct / y.length;
  }

  toJSON() {
    return {
      nClasses: this.nClasses,
      nFeatures: this.nFeatures,
      temperature: this.temperature,
      W: this.W.map(r => Array.from(r, v => Math.round(v * 1e4) / 1e4)),
      b: this.b,
    };
  }

  static fromJSON(data) {
    const m = new SoftmaxRegression({ nClasses: data.nClasses, nFeatures: data.nFeatures, temperature: data.temperature });
    m.W = data.W;
    m.b = data.b;
    return m;
  }
}

module.exports = { SoftmaxRegression };