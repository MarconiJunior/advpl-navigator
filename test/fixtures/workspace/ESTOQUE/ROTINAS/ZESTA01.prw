#Include "TOTVS.ch"

/*/{Protheus.doc} ZESTA01
Manutenção de itens do estoque (fonte fictício para os testes).
@type function
/*/
User Function ZESTA01()
	Local aCols    := {}
	Local cLinhaOk := "U_ZVALLIN()" // Valida a linha atual do aCols

	aAdd(aCols, {"0001", 10})
	MsgInfo("Itens: " + cValToChar(Len(aCols)))
Return

/*/{Protheus.doc} ZVALLIN
Valida a linha atual do aCols.
@type function
@param nLine, numeric, linha a validar
/*/
User Function ZVALLIN(nLine)
Return .T.
