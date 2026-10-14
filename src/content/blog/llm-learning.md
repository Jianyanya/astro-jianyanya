---
title: "LLM 学习"
link: "llm-learning"
date: 2026-09-01 22:28:00
catalog: true
tags:
  - "LLM"
categories:
  - ["项目", "复合对话Agent"]
---
# 模型训练
## 模型部署

## 数据集训练
[人类对齐]([modelscope-classroom/LLM-tutorial/M.人类偏好对齐训练.md at main · modelscope/modelscope-classroom](https://github.com/modelscope/modelscope-classroom/blob/main/LLM-tutorial/M.%E4%BA%BA%E7%B1%BB%E5%81%8F%E5%A5%BD%E5%AF%B9%E9%BD%90%E8%AE%AD%E7%BB%83.md))
[大模型训练与推理]([Swift DOCUMENTATION — swift 4.5.0.dev0 文档](https://swift.readthedocs.io/zh-cn/latest/))

# transformer

[GitHub](https://github.com/huggingface/transformers)
[系统学习]([系统学习 (6 小时) | minimind 从零理解 llm 训练 | minimind 从零理解 llm 训练](https://www.minimind.wiki/docs/guide/systematic))
[深度掌握]([深度掌握 (30+小时) | minimind 从零理解 llm 训练 | minimind 从零理解 llm 训练](https://www.minimind.wiki/docs/guide/mastery))

## 核心机制一：自注意力（Self-Attention）

## 核心机制二：多头注意力（Multi-Head Attention）

## 核心机制三：位置编码（Positional Encoding）

## 核心机制四：前馈网络（Feed-Forward Network, FFN）

## 核心机制五：残差连接与层归一化

## 技术论文

[奠基之作](https://arxiv.org/abs/1706.03762)

### **三大架构变体**
1. [BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding](https://arxiv.org/abs/1810.04805)
2. [Language Models are Unsupervised Multitask Learners](https://arxiv.org/abs/1909.07930)
3. [**Language Models are Few-Shot Learners**](https://arxiv.org/abs/2005.14165)
4. [**Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer**](https://arxiv.org/abs/1910.10683)

### **位置编码的演进**
1. [**RoFormer: Enhanced Transformer with Rotary Position Embedding**](https://arxiv.org/abs/2104.09864)
2. [**YaRN: Efficient Context Window Extension of Large Language Models**](https://arxiv.org/abs/2309.00071)

### **FFN 与激活函数的演进**
1. [**GLU Variants Improve Transformer**](https://arxiv.org/abs/2002.05202)
2. [博采众长的旋转式位置编码](https://kexue.fm/archives/8265)
#### 同时这里补充关于激活函数的理论视角

[信号传播理论(Mean Field Theory)](https://arxiv.org/abs/1611.01730)
[神经正切核（NTK）理论](https://arxiv.org/abs/1806.07572)
[表达能力的深度-宽度权衡](https://arxiv.org/abs/1503.02406)
[信息瓶颈理论](https://arxiv.org/abs/1606.05340)

这里 ai 补充了另一种视角叫**梯度景观与优化动力学**

这个视角最直接地解释"为什么模型能训得动"。
激活函数通过其导数形状决定了反向传播时梯度的行为：
- **ReLU**：导数在正半轴恒为 1（梯度传播好），负半轴恒为 0（神经元可能永久死亡）。
- **GELU**：负半轴有非零梯度，避免了死亡问题，但在 x ≈ 0 附近梯度变化剧烈，可能导致优化不稳定。
- **Swish**（x · σ(βx)）：负半轴有非零且有界的值（不会死亡），在 x ≈ 0 处光滑（优化稳定），且导数值域更宽（梯度信号更丰富）。当 β 可学习时，网络甚至可以自适应调整激活函数的"硬度"。
门控机制（GLU 系列）在此基础上叠加了**输入相关的动态调制**——对于每个输入，门控分支产生不同的梯度缩放因子。这等价于让优化器在每一步都有更好的"方向指引"，降低了陷入鞍点或平坦区域的概率。

### **MoE（混合专家）**
1. [**Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer**](https://arxiv.org/abs/1701.06538)
2. [**Mixtral of Experts**](https://arxiv.org/abs/2401.04088)
### **规模定律与训练范式**
1. [**Scaling Laws for Neural Language Models**](https://arxiv.org/abs/2001.08361)
2. [**Training Compute-Optimal Large Language Models**](https://arxiv.org/abs/2203.15556)
### **现代 LLaMA 系列**
1. [**LLaMA: Open and Efficient Foundation Language Models**](https://arxiv.org/abs/2302.13971)
2. [**DeepSeek-V3 Technical Report**](https://arxiv.org/abs/2412.19437)

