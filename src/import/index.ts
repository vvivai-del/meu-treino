// Importação de treino: texto do personal (+ vídeo opcional) → treino no banco local.
//
// CONTRATO — usado pela tela de importação e pelo boot do app.
//
// Princípio: o treino fica utilizável assim que o TEXTO é interpretado (segundos).
// O vídeo é enviado e analisado em segundo plano; os trechos são gravados nos itens
// quando ficam prontos. O andamento fica em `Workout.videoStatus`, então as telas
// acompanham por live query e a importação sobrevive a fechar o app.

import type { ID, ISODate } from '../domain/types';

export interface ImportInput {
  text: string;
  video?: File;
  /** Dia planejado. Padrão: hoje (data local). */
  date?: ISODate;
}

export { importWorkout, resumePendingImports, retryVideo } from './pipeline';

// Assinaturas de referência:
//
// importWorkout(input: ImportInput): Promise<ID>
//   Resolve com o id do treino assim que texto → itens estão gravados.
//   Se houver vídeo: grava o blob localmente ANTES de qualquer chamada de rede,
//   e continua o envio/análise em segundo plano (não bloqueia a promise).
//
// resumePendingImports(): Promise<void>
//   Chamado no boot: retoma treinos com videoStatus 'pendente' | 'enviando' | 'analisando'.
//
// retryVideo(workoutId: ID): Promise<void>
//   Reprocessa o vídeo de um treino com videoStatus 'erro'.

export type { ID };
