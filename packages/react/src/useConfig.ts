import React, { useContext, useState, useEffect } from 'react'
import { FeatureFlagContext } from './Context'

const useConfig = (configSelector, parser) => {
  const ctx = useContext(FeatureFlagContext)
  const [state, setState] = useState(ctx.get(configSelector))

  useEffect(() => {
    return ctx.subscribe(() => {
      const value = ctx.get(configSelector)
      setState(value)
    })
  }, [])

  return parser ? parser(state?.metadata) : state.value
}

export default useConfig
