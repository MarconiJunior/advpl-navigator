#Include "TOTVS.ch"

/*/{Protheus.doc} ZCOMPE01
Ponto de entrada após a gravação do documento de entrada (fonte fictício para os testes).
@type function
/*/
User Function ZCOMPE01()
	Local aItens := {}

	If !Empty(aItens)
		EnvAviso(aItens, SF1->F1_DOC, SF1->F1_SERIE)
	EndIf
Return

/*/{Protheus.doc} EnvAviso
Envia o aviso de recebimento.
@type function
@param aItens, array, itens recebidos
@param cDoc, character, número do documento
@param cSerie, character, série do documento
/*/
Static Function EnvAviso(aItens, cDoc, cSerie)
	ConOut("Aviso: " + cDoc + "/" + cSerie)
Return
