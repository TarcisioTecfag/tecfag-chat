import { db } from "../../db";
import { internalMessages, messages, conversations, contacts } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { vertexAi } from "../vertex-ai";
import crypto from "crypto";

const uuidv4 = () => crypto.randomUUID();

export interface SentimentAnalysisResult {
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  score: number;
  shouldAlert: boolean;
}

class SentimentAnalyzer {
  private static instance: SentimentAnalyzer;
  
  // Rastreamento de contagem de mensagens: Map<conversationId, count>
  private messageCounts = new Map<string, number>();
  
  // Rate limiting para alertas: Map<conversationId, timestamp em ms>
  private lastAlertTimes = new Map<string, number>();
  
  private constructor() {}

  public static getInstance(): SentimentAnalyzer {
    if (!SentimentAnalyzer.instance) {
      SentimentAnalyzer.instance = new SentimentAnalyzer();
    }
    return SentimentAnalyzer.instance;
  }

  /**
   * 1. Camada Heurística (Custo Zero)
   * Analisa a mensagem com base em palavras-chave e padrões de texto
   */
  private analyzeHeuristic(content: string): { score: number, sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' } {
    const text = content.toLowerCase();
    
    const frustratedWords = ['demora', 'absurdo', 'péssimo', 'lixo', 'vergonha', 'descaso', 'inaceitável', 'poha', 'pqp', 'foda', 'merda', 'desgraça', 'incompetente'];
    const positiveWords = ['excelente', 'parabéns', 'obrigado', 'obrigada', 'rápido', 'ótimo', 'maravilhoso', 'perfeito', 'top', 'show'];
    
    let score = 0;
    
    // Checar palavras de frustração
    for (const word of frustratedWords) {
      if (text.includes(word)) {
        score -= 0.5;
      }
    }
    
    // Checar palavras positivas
    for (const word of positiveWords) {
      if (text.includes(word)) {
        score += 0.3;
      }
    }
    
    // Checar padrões de texto com letras maiúsculas (>70% em mensagens com mais de 20 letras)
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 20) {
      const upperCount = letters.split('').filter(c => c === c.toUpperCase()).length;
      if (upperCount / letters.length > 0.7) {
        score -= 0.6;
      }
    }
    
    // Checar uso excessivo de pontuação de ênfase
    if (content.includes('???') || content.includes('!!!')) {
      score -= 0.4;
    }
    
    // Limitar score entre -1 e 1
    score = Math.max(-1, Math.min(1, score));
    
    let sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' = 'neutral';
    if (score <= -0.6) sentiment = 'frustrated';
    else if (score < -0.2) sentiment = 'negative';
    else if (score > 0.3) sentiment = 'positive';
    
    return { score, sentiment };
  }

  /**
   * 2. Camada de IA (Gemini 1.5 Flash - Baixo custo)
   * Envia o contexto recente para análise profunda
   */
  private async analyzeAI(
    conversationId: string, 
    tenantId: string, 
    metadata?: any
  ): Promise<{ sentiment: string, score: number } | null> {
    // Buscar as últimas 5 mensagens
    const historyMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.sentAt))
      .limit(5);

    if (historyMsgs.length === 0) return null;

    // Montar histórico (ordenado cronologicamente)
    const chatHistory = historyMsgs
      .reverse()
      .map(m => `[${m.senderType === 'client' ? 'Cliente' : 'Agente'}]: ${m.content}`)
      .join('\n');

    const prompt = `Analise o sentimento desta conversa de atendimento ao cliente.\n\nHistórico:\n${chatHistory}\n\nRetorne EXCLUSIVAMENTE um objeto JSON estruturado: { "sentiment": "positive" | "neutral" | "negative" | "frustrated", "confidence": number (0 a 1), "reason": "string" }`;

    const aiResult = await vertexAi.generateStructuredJson<{ sentiment: string, confidence: number, reason: string }>(
      prompt,
      'gemini-1.5-flash',
      undefined,
      { tenantId, feature: 'sentiment_analysis', metadata }
    );

    if (!aiResult) return null;

    let score = 0;
    switch (aiResult.sentiment) {
      case 'positive': score = 0.8; break;
      case 'neutral': score = 0; break;
      case 'negative': score = -0.5; break;
      case 'frustrated': score = -0.9; break;
      default: score = 0; break;
    }

    return { sentiment: aiResult.sentiment, score };
  }

  /**
   * 3. Geração de Alertas
   * Notifica o supervisor caso o cliente esteja frustrado, respeitando o rate limit
   */
  private async triggerAlert(conversationId: string, tenantId: string, sentiment: string, contactName: string) {
    const now = Date.now();
    const lastAlert = this.lastAlertTimes.get(conversationId) || 0;
    
    // Rate limit: 1 alerta a cada 20 minutos por conversa
    if (now - lastAlert < 20 * 60 * 1000) {
      return;
    }
    
    this.lastAlertTimes.set(conversationId, now);

    // Buscar a conversa para encontrar o operador alocado
    const convRows = await db
      .select({ operatorId: conversations.operatorId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    
    if (convRows.length === 0 || !convRows[0].operatorId) return;
    const conv = convRows[0];

    const humanizedMsg = `🚨 Detectei frustração na conversa com o cliente *${contactName}*. Pode ser uma boa ideia dar uma atenção e acalmá-lo!`;

    // Inserir nota interna (como mensagem de supervisor)
    await db.insert(internalMessages).values({
      id: uuidv4(),
      tenantId,
      operatorId: conv.operatorId || 'system',
      direction: 'from_agent',
      agentType: 'supervisor',
      content: humanizedMsg,
      metadata: { type: 'sentiment_alert', title: `Sentimento negativo — ${contactName}`, conversationId, sentiment, contactName },
      read: 0,
      createdAt: new Date(),
    });
  }

  /**
   * Ponto de entrada principal
   */
  public async analyzeMessage(
    content: string, 
    conversationId: string, 
    tenantId: string, 
    metadata?: any
  ): Promise<SentimentAnalysisResult> {
    
    // 1. Camada Heurística
    const heuristicResult = this.analyzeHeuristic(content);
    let finalScore = heuristicResult.score;
    let finalSentiment = heuristicResult.sentiment;
    
    // 2. Incrementar contagem de mensagens
    const count = (this.messageCounts.get(conversationId) || 0) + 1;
    this.messageCounts.set(conversationId, count);

    // 3. IA Layer (disparado a cada 5 mensagens ou heurística muito negativa)
    if (count % 5 === 0 || finalScore < -0.5) {
      const aiResult = await this.analyzeAI(conversationId, tenantId, metadata);
      if (aiResult) {
        finalScore = aiResult.score;
        finalSentiment = aiResult.sentiment as 'positive' | 'neutral' | 'negative' | 'frustrated';
      }
    }
    
    // 4. Verificação de Alertas
    let shouldAlert = false;
    if (finalScore <= -0.6 || finalSentiment === 'frustrated') {
      shouldAlert = true;
      
      let resolvedContactName = metadata?.contactName || 'Cliente';
      
      // Tentar resolver o nome do contato se não foi enviado no metadata
      if (resolvedContactName === 'Cliente') {
          const convRows2 = await db
            .select({ contactId: conversations.contactId })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);
          if (convRows2.length > 0 && convRows2[0].contactId) {
             const contactRows = await db
               .select({ name: contacts.name })
               .from(contacts)
               .where(eq(contacts.id, convRows2[0].contactId))
               .limit(1);
             if (contactRows.length > 0) resolvedContactName = contactRows[0].name;
          }
      }

      await this.triggerAlert(conversationId, tenantId, finalSentiment, resolvedContactName);
    }
    
    return {
      sentiment: finalSentiment,
      score: finalScore,
      shouldAlert
    };
  }
}

// Exportações
export const sentimentAnalyzer = SentimentAnalyzer.getInstance();
export const analyzeSentiment = sentimentAnalyzer.analyzeMessage.bind(sentimentAnalyzer);
