#Include "TOTVS.ch"

/*/{Protheus.doc} ZFATA02
Faturamento de pedidos (fonte fictício para os testes).
@type function
/*/
User Function ZFATA02()
	Local lOk := U_ZVALLIN(1)

	If ExistBlock("ZVALLIN")
		lOk := ExecBlock("ZVALLIN", .F., .F., {2})
	EndIf
Return lOk
